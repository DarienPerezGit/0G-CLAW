import type {
  IMemoryAdapter,
  AgentSession,
  SessionMessage,
} from './IMemoryAdapter.js';

// ---------------------------------------------------------------------------
// 0G Storage SDK types (used only after dynamic import in _getClient)
// ---------------------------------------------------------------------------

// Internal shape of the initialized SDK client bundle — stored after first use.
interface OGClientBundle {
  /** 0G Storage Indexer — coordinates uploads via selectNodes() + flow contract */
  indexer: {
    selectNodes(
      expectedReplica: number,
    ): Promise<[StorageNodeLike[], Error | null]>;
  };
  /** KV client — reads from the 0G KV storage node */
  kvClient: {
    getValue(
      streamId: string,
      key: Uint8Array,
      version?: number,
    ): Promise<{ version: number; data: string; size: number } | null>;
  };
  /** Flow contract instance (signer embedded) — used by Batcher for on-chain tx */
  flowContract: unknown;
  /** Batcher constructor — batch KV writes into a single storage transaction */
  BatcherClass: new (
    version: number,
    clients: StorageNodeLike[],
    flow: unknown,
    provider: string,
  ) => {
    streamDataBuilder: {
      set(streamId: string, key: Uint8Array, data: Uint8Array): void;
    };
    exec(
      opts?: unknown,
    ): Promise<[{ txHash: string; rootHash: string }, Error | null]>;
  };
  /** Resolved stream ID — 32-byte hex, unique namespace for this agent wallet */
  streamId: string;
}

// Minimal StorageNode interface used by Batcher
interface StorageNodeLike {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface OGMemoryAdapterConfig {
  /**
   * EVM-compatible RPC endpoint for signing and submitting storage transactions.
   * Example: "https://evmrpc-testnet.0g.ai"
   */
  rpc: string;

  /**
   * Storage indexer endpoint — used to discover storage nodes.
   * Example: "https://indexer-storage-testnet-standard.0g.ai"
   */
  indexer: string;

  /**
   * KV storage node RPC endpoint — used for reading KV values.
   * This is a separate endpoint from the indexer.
   * Example: "http://3.101.147.150:6789"
   */
  kvRpc: string;

  /**
   * Flow contract address on the EVM chain.
   * Controls fee payment for storage operations.
   * Find the testnet address at: https://docs.0g.ai/build-with-0g/storage-sdk
   */
  flowContractAddress: string;

  /**
   * Wallet private key for signing storage transactions.
   * Must be provided via environment variable — never hardcoded.
   */
  privateKey: string;

  /**
   * 32-byte hex stream ID for this agent's KV namespace.
   * If omitted, derived from the wallet address:
   *   keccak256(utf8("0g-claw:" + walletAddress))
   * This makes the namespace portable — same wallet → same namespace on any machine.
   */
  streamId?: string;

  /**
   * Local cache directory (reserved for future download caching).
   * Defaults to ~/.0g-claw/cache
   */
  cacheDir?: string;
}

// ---------------------------------------------------------------------------
// Key namespacing helpers
// ---------------------------------------------------------------------------

function sessionKey(agentId: string, sessionId: string): string {
  return `session:${agentId}:${sessionId}`;
}

function sessionIndexKey(agentId: string): string {
  return `index:${agentId}`;
}

function configKey(agentId: string): string {
  return `config:${agentId}`;
}

function historyKey(agentId: string, sessionId: string): string {
  return `history:${agentId}:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decode<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

// ---------------------------------------------------------------------------
// 0GMemoryAdapter
// ---------------------------------------------------------------------------

/**
 * 0G Storage-backed implementation of IMemoryAdapter.
 *
 * Storage mapping:
 *   KV stream key `session:<agentId>:<sessionId>` → AgentSession (mutable state)
 *   KV stream key `index:<agentId>`               → string[] (sessionId list)
 *   KV stream key `config:<agentId>`              → string (agent config blob)
 *   KV stream key `history:<agentId>:<sessionId>` → SessionMessage[] (log array)
 *
 * 0G-native capabilities enabled by this adapter:
 *   - Portable agent identity: same wallet → same state on any machine
 *   - Verifiable execution history: all writes go through the 0G flow contract
 *   - Multi-agent shared memory: agents sharing a wallet share a KV namespace
 *   - Replayable sessions: history key stores ordered message log, readable from genesis
 *
 * Configuration is injected via constructor — no env vars are read here.
 * The caller reads process.env and passes values in.
 */
export class OGMemoryAdapter implements IMemoryAdapter {
  private readonly config: OGMemoryAdapterConfig;
  private _bundle: OGClientBundle | null = null;

  constructor(config: OGMemoryAdapterConfig) {
    if (!config.rpc) throw new Error('OGMemoryAdapter: config.rpc is required');
    if (!config.indexer) throw new Error('OGMemoryAdapter: config.indexer is required');
    if (!config.kvRpc) throw new Error('OGMemoryAdapter: config.kvRpc is required');
    if (!config.flowContractAddress)
      throw new Error('OGMemoryAdapter: config.flowContractAddress is required');
    if (!config.privateKey)
      throw new Error('OGMemoryAdapter: config.privateKey is required');
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Internal: SDK client bundle (lazy init, cached after first call)
  // ---------------------------------------------------------------------------

  /**
   * Initializes and caches the 0G SDK client bundle on first use.
   * Subsequent calls return the cached bundle without re-initializing.
   *
   * 0G-native: this is the only point where SDK credentials are used.
   */
  private async _getClient(): Promise<OGClientBundle> {
    if (this._bundle !== null) return this._bundle;

    try {
      // Dynamic import — avoids hard-failing if the SDK is not installed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const og = await import('@0glabs/0g-ts-sdk') as any;
      const { ethers } = await import('ethers');

      const provider = new ethers.JsonRpcProvider(this.config.rpc);
      const signer = new ethers.Wallet(this.config.privateKey, provider);

      // Derive stream ID from wallet address if not provided in config.
      // keccak256("0g-claw:<address>") gives a stable 32-byte namespace per wallet.
      const streamId: string =
        this.config.streamId ??
        ethers.keccak256(ethers.toUtf8Bytes(`0g-claw:${signer.address}`));

      const indexer = new og.Indexer(this.config.indexer) as OGClientBundle['indexer'];
      const kvClient = new og.KvClient(this.config.kvRpc) as OGClientBundle['kvClient'];
      const flowContract = og.getFlowContract(this.config.flowContractAddress, signer);

      this._bundle = {
        indexer,
        kvClient,
        flowContract,
        BatcherClass: og.Batcher as OGClientBundle['BatcherClass'],
        streamId,
      };
      return this._bundle;
    } catch (err) {
      throw new Error(
        `OGMemoryAdapter: failed to initialize 0G SDK client: ${String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: KV read — off-chain query to the KV storage node
  // ---------------------------------------------------------------------------

  /**
   * Reads a value from the 0G KV store by key.
   * Returns null if the key has never been written.
   *
   * 0G-native: reads go directly to the KV storage node (no on-chain tx needed).
   * The same key returns the same value from any machine — enabling portable state.
   */
  private async _kvGet(key: string): Promise<Uint8Array | null> {
    const { kvClient, streamId } = await this._getClient();
    const keyBytes = new TextEncoder().encode(key);
    let val: { data: string; version: number; size: number } | null;
    try {
      val = await kvClient.getValue(streamId, keyBytes);
    } catch (err) {
      const msg = String(err);
      // KV node returns a JSON-RPC error for missing keys — treat as null.
      if (msg.includes('not found') || msg.includes('does not exist')) return null;
      throw new Error(`OGMemoryAdapter: KV read failed for key "${key}": ${msg}`);
    }
    if (val === null) return null;
    // val.data is a Base64-encoded string (0G SDK's wire format for binary data)
    return new Uint8Array(Buffer.from(val.data, 'base64'));
  }

  // ---------------------------------------------------------------------------
  // Internal: KV write — on-chain transaction via Batcher + flow contract
  // ---------------------------------------------------------------------------

  /**
   * Writes a value to the 0G KV store by key.
   * Submits an on-chain transaction via the flow contract (requires gas).
   *
   * 0G-native: writes are signed by the wallet and anchored in the 0G chain,
   * making them verifiable and globally readable by any node in the network.
   */
  private async _kvSet(key: string, value: Uint8Array): Promise<void> {
    const { indexer, flowContract, BatcherClass, streamId } = await this._getClient();

    const [nodes, selectErr] = await indexer.selectNodes(1);
    if (selectErr !== null) {
      throw new Error(
        `OGMemoryAdapter: failed to select storage nodes: ${String(selectErr)}`,
      );
    }

    const batcher = new BatcherClass(1, nodes, flowContract, this.config.rpc);
    const keyBytes = new TextEncoder().encode(key);
    batcher.streamDataBuilder.set(streamId, keyBytes, value);

    const [, writeErr] = await batcher.exec();
    if (writeErr !== null) {
      throw new Error(
        `OGMemoryAdapter: KV write failed for key "${key}": ${String(writeErr)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Log append/read — ordered message history via KV array
  // ---------------------------------------------------------------------------

  /**
   * Appends a value to the ordered log stored under `key`.
   * Implemented as read-modify-write over a versioned KV key.
   *
   * TODO(step-2): wire after _kvGet/_kvSet testnet validation.
   * 0G-native: each version of the history key in the 0G chain is the
   * replayable execution log — an observer can reconstruct any session from genesis.
   */
  private async _logAppend(key: string, value: Uint8Array): Promise<void> {
    void key;
    void value;
    throw new Error(
      'OGMemoryAdapter._logAppend: pending step-2 wiring (confirm after KV checkpoint)',
    );
  }

  /**
   * Reads all log entries for `key` in order.
   * Returns an empty array if the log has never been written.
   *
   * TODO(step-2): wire after _kvGet/_kvSet testnet validation.
   */
  private async _logRead(key: string): Promise<Uint8Array[]> {
    void key;
    throw new Error(
      'OGMemoryAdapter._logRead: pending step-2 wiring (confirm after KV checkpoint)',
    );
  }

  // ---------------------------------------------------------------------------
  // IMemoryAdapter — KV session state
  // ---------------------------------------------------------------------------

  async saveSession(session: AgentSession): Promise<void> {
    await this._kvSet(sessionKey(session.agentId, session.sessionId), encode(session));

    // Update index: read-modify-write, idempotent
    const existing = await this._kvGet(sessionIndexKey(session.agentId));
    const ids: string[] = existing ? decode<string[]>(existing) : [];
    if (!ids.includes(session.sessionId)) {
      ids.push(session.sessionId);
      await this._kvSet(sessionIndexKey(session.agentId), encode(ids));
    }
  }

  async loadSession(agentId: string, sessionId: string): Promise<AgentSession | null> {
    const raw = await this._kvGet(sessionKey(agentId, sessionId));
    if (raw === null) return null;
    return decode<AgentSession>(raw);
  }

  async listSessions(agentId: string): Promise<string[]> {
    const raw = await this._kvGet(sessionIndexKey(agentId));
    if (raw === null) return [];
    return decode<string[]>(raw);
  }

  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    // 0G Storage has no delete API — removal means removing from the index.
    // The raw KV entry persists until the storage contract expires.
    const existing = await this._kvGet(sessionIndexKey(agentId));
    if (existing !== null) {
      const ids = decode<string[]>(existing).filter((id) => id !== sessionId);
      await this._kvSet(sessionIndexKey(agentId), encode(ids));
    }
  }

  // ---------------------------------------------------------------------------
  // IMemoryAdapter — Log append-only history (wired in step 2)
  // ---------------------------------------------------------------------------

  async appendMessage(
    agentId: string,
    sessionId: string,
    message: SessionMessage,
  ): Promise<void> {
    await this._logAppend(historyKey(agentId, sessionId), encode(message));
  }

  async loadHistory(agentId: string, sessionId: string): Promise<SessionMessage[]> {
    const entries = await this._logRead(historyKey(agentId, sessionId));
    return entries.map((bytes) => decode<SessionMessage>(bytes));
  }

  // ---------------------------------------------------------------------------
  // IMemoryAdapter — Config
  // ---------------------------------------------------------------------------

  async saveConfig(agentId: string, config: string): Promise<void> {
    await this._kvSet(configKey(agentId), encode(config));
  }

  async loadConfig(agentId: string): Promise<string | null> {
    const raw = await this._kvGet(configKey(agentId));
    if (raw === null) return null;
    return decode<string>(raw);
  }
}
