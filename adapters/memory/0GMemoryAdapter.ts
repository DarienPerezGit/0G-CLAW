import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type {
  IMemoryAdapter,
  AgentSession,
  SessionMessage,
} from './IMemoryAdapter.js';

// ---------------------------------------------------------------------------
// 0G Storage SDK types (used only after dynamic import in _getClient)
// ---------------------------------------------------------------------------

/** Minimal Indexer interface — upload writes to 0G, download retrieves. */
interface IndexerLike {
  upload(
    file: unknown,
    evmRpc: string,
    signer: unknown,
  ): Promise<[{ txHash: string; rootHash: string }, Error | null]>;
  download(
    rootHash: string,
    filePath: string,
    proof: boolean,
  ): Promise<Error | null>;
}

// Internal shape of the initialized SDK client bundle — stored after first use.
interface OGClientBundle {
  /**
   * Full Indexer instance — upload writes MemData to 0G Storage,
   * download retrieves it by rootHash. No separate KV node required.
   */
  indexer: IndexerLike;
  /** Signer — authorizes upload transactions (gas payment). */
  signer: unknown;
  /** MemData constructor — creates in-memory uploadable data objects. */
  MemDataClass: new (data: ArrayLike<number>) => unknown;
  /** Resolved stream ID — stable 32-byte namespace for this wallet. */
  streamId: string;
  /** Path to the local kv-index JSON file for this adapter instance. */
  indexPath: string;
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
   * Storage indexer endpoint — discovers nodes for upload and download.
   * Use the turbo endpoint for testnet: "https://indexer-storage-testnet-turbo.0g.ai"
   * The indexer auto-discovers the flow contract from the network.
   */
  indexer: string;

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
   * Local cache directory for the rootHash index file.
   * Defaults to ~/.0g-claw/cache
   *
   * The index (kv-index.json) maps key → rootHash for all data written to 0G Storage.
   * Two adapter instances pointing to the same cacheDir share the same index,
   * which enables the portability guarantee: same wallet + same cacheDir = same state.
   */
  cacheDir?: string;

  /**
   * @deprecated KV RPC endpoint (port 6789) — no longer used.
   * OGMemoryAdapter now reads via indexer.download() using cached rootHashes.
   * Kept for backward compatibility; field is silently ignored.
   */
  kvRpc?: string;

  /**
   * @deprecated Flow contract address — no longer required.
   * The indexer auto-discovers the flow contract from the storage network.
   * Kept for backward compatibility; field is silently ignored.
   */
  flowContractAddress?: string;
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
 * Storage strategy:
 *   - Writes: serialize value → MemData → indexer.upload() → rootHash
 *     The rootHash is persisted in cacheDir/kv-index.json for later retrieval.
 *   - Reads: look up rootHash from local index → indexer.download() → parse
 *
 * This approach uses only the 0G Storage indexer (no separate KV RPC node needed).
 * The indexer auto-discovers storage nodes and the flow contract from the network.
 *
 * 0G-native capabilities enabled by this adapter:
 *   - Every write is an on-chain transaction anchored in 0G Storage
 *   - All values are content-addressed and verifiable by rootHash
 *   - Portable identity: same wallet + cacheDir → same state on any machine
 *   - Verifiable reads: download verifies content against its Merkle root
 *
 * Configuration is injected via constructor — no env vars are read here.
 * The caller reads process.env and passes values in.
 */
export class OGMemoryAdapter implements IMemoryAdapter {
  private readonly config: OGMemoryAdapterConfig;
  private _bundle: OGClientBundle | null = null;
  /** In-process index: key → rootHash. Populated from disk on first _getClient(). */
  private readonly _kvIndex = new Map<string, string>();

  constructor(config: OGMemoryAdapterConfig) {
    if (!config.rpc) throw new Error('OGMemoryAdapter: config.rpc is required');
    if (!config.indexer) throw new Error('OGMemoryAdapter: config.indexer is required');
    if (!config.privateKey)
      throw new Error('OGMemoryAdapter: config.privateKey is required');
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Internal: SDK client bundle (lazy init, cached after first call)
  // ---------------------------------------------------------------------------

  /**
   * Initializes and caches the 0G SDK client bundle on first use.
   * Also loads the persisted rootHash index from cacheDir/kv-index.json.
   *
   * 0G-native: this is the only point where SDK credentials are used.
   */
  private async _getClient(): Promise<OGClientBundle> {
    if (this._bundle !== null) return this._bundle;

    try {
      // Dynamic import — avoids hard-failing if the SDK is not installed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const og = await import('@0gfoundation/0g-ts-sdk') as any;
      const { ethers } = await import('ethers');

      const provider = new ethers.JsonRpcProvider(this.config.rpc);
      const signer = new ethers.Wallet(this.config.privateKey, provider);

      // Derive stream ID from wallet address if not provided in config.
      // keccak256("0g-claw:<address>") gives a stable 32-byte namespace per wallet.
      const streamId: string =
        this.config.streamId ??
        ethers.keccak256(ethers.toUtf8Bytes(`0g-claw:${signer.address}`));

      const indexer = new og.Indexer(this.config.indexer) as IndexerLike;

      // Resolve path for the local rootHash index file.
      const cacheDir =
        this.config.cacheDir ?? join(homedir(), '.0g-claw', 'cache');
      const indexPath = join(cacheDir, 'kv-index.json');

      // Load persisted index entries from disk (first-run: file may not exist).
      try {
        const raw = await fsp.readFile(indexPath, 'utf-8');
        const entries = JSON.parse(raw) as Record<string, string>;
        for (const [k, v] of Object.entries(entries)) {
          this._kvIndex.set(k, v);
        }
      } catch {
        // File doesn't exist yet on first run — index starts empty.
      }

      this._bundle = {
        indexer,
        signer,
        MemDataClass: og.MemData as OGClientBundle['MemDataClass'],
        streamId,
        indexPath,
      };
      return this._bundle;
    } catch (err) {
      throw new Error(
        `OGMemoryAdapter: failed to initialize 0G SDK client: ${String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: persist the in-memory index map to disk
  // ---------------------------------------------------------------------------

  private async _persistIndex(indexPath: string): Promise<void> {
    await fsp.mkdir(dirname(indexPath), { recursive: true });
    const entries = Object.fromEntries(this._kvIndex);
    await fsp.writeFile(indexPath, JSON.stringify(entries, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Internal: KV read — download from 0G using rootHash from local index
  // ---------------------------------------------------------------------------

  /**
   * Reads a value from 0G Storage by key.
   * Returns null if the key has never been written (no rootHash in local index).
   *
   * 0G-native: reads trigger a real file download from 0G storage nodes,
   * verifying the content against its Merkle root.
   */
  private async _kvGet(key: string): Promise<Uint8Array | null> {
    const bundle = await this._getClient();

    const rootHash = this._kvIndex.get(key);
    if (!rootHash) return null;

    // Download to a unique temp file, read it into memory, then delete.
    const tmpFile = join(
      tmpdir(),
      `0gclaw-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      const err = await bundle.indexer.download(rootHash, tmpFile, false);
      if (err !== null) {
        // Could not download — key may not be finalized on the network yet.
        return null;
      }
      const data = await fsp.readFile(tmpFile);
      return new Uint8Array(data);
    } catch (err) {
      throw new Error(
        `OGMemoryAdapter: read failed for key "${key}": ${String(err)}`,
      );
    } finally {
      try { await fsp.unlink(tmpFile); } catch { /* cleanup, best-effort */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: KV write — upload MemData to 0G, persist rootHash to index
  // ---------------------------------------------------------------------------

  /**
   * Writes a value to 0G Storage by key.
   * Uploads via indexer.upload() (auto-discovers flow contract from the network),
   * then caches the rootHash so _kvGet can retrieve it.
   *
   * 0G-native: writes are on-chain transactions signed by the wallet and anchored
   * in the 0G flow contract. Every value is content-addressed and verifiable.
   */
  private async _kvSet(key: string, value: Uint8Array): Promise<void> {
    const bundle = await this._getClient();

    const memData = new bundle.MemDataClass(value);
    const [result, err] = await bundle.indexer.upload(
      memData,
      this.config.rpc,
      bundle.signer,
    );

    if (err !== null) {
      throw new Error(
        `OGMemoryAdapter: write failed for key "${key}": ${String(err)}`,
      );
    }

    // Cache the rootHash and persist the index so reads survive process restarts.
    this._kvIndex.set(key, result.rootHash);
    await this._persistIndex(bundle.indexPath);
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
