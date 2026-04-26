import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  IMemoryAdapter,
  AgentSession,
  SessionMessage,
} from './IMemoryAdapter.js';

// ---------------------------------------------------------------------------
// 0G Storage SDK types — imported only when 0G is available at runtime.
// The adapter dynamically requires these to avoid hard failure when the SDK
// is not configured. All 0G-specific code is isolated behind the _storage
// and _kv/_log handle pattern below.
// ---------------------------------------------------------------------------

export interface OGMemoryAdapterConfig {
  /**
   * EVM-compatible RPC endpoint for the 0G chain.
   * Example: "https://evmrpc-testnet.0g.ai"
   */
  rpc: string;

  /**
   * Storage indexer endpoint — used to locate stored data.
   * Example: "https://indexer-storage-testnet-standard.0g.ai"
   */
  indexer: string;

  /**
   * Wallet private key for signing storage transactions.
   * Must be provided via environment variable — never hardcoded.
   */
  privateKey: string;

  /**
   * Local cache directory for 0G data during sync operations.
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
 *   KV Store key `session:<agentId>:<sessionId>`   → AgentSession (mutable state)
 *   KV Store key `index:<agentId>`                 → string[] (sessionId list)
 *   KV Store key `config:<agentId>`                → string (agent config blob)
 *   KV Store key `history:<agentId>:<sessionId>`   → SessionMessage[] (append-only log)
 *
 * 0G-Native capability: history is stored in the 0G Log Store (append-only,
 * replayable from any machine with the same wallet). This enables:
 *   - Portable agent identity across devices
 *   - Verifiable execution history
 *   - Multi-agent shared memory over the same KV namespace
 *
 * Configuration is injected via constructor — no env vars are read here.
 * The caller is responsible for reading process.env and passing values in.
 *
 * All methods reject with descriptive Errors on SDK or network failure.
 */
export class OGMemoryAdapter implements IMemoryAdapter {
  private readonly config: OGMemoryAdapterConfig;
  // 0G SDK client — initialized lazily on first use via _getClient()
  private _client: unknown = null;

  constructor(config: OGMemoryAdapterConfig) {
    // Validate at construction time — fail fast, not at first use.
    if (!config.rpc) throw new Error('OGMemoryAdapter: config.rpc is required');
    if (!config.indexer) throw new Error('OGMemoryAdapter: config.indexer is required');
    if (!config.privateKey) throw new Error('OGMemoryAdapter: config.privateKey is required');
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Internal: 0G SDK client (lazy init)
  // ---------------------------------------------------------------------------

  /**
   * Returns an initialized 0G Storage client.
   * Throws if the SDK is unavailable or credentials are invalid.
   *
   * 0G-native: This is the entry point for all verifiable storage operations.
   */
  private async _getClient(): Promise<OGStorageClient> {
    if (this._client !== null) {
      return this._client as OGStorageClient;
    }
    try {
      // Dynamic import isolates the 0G SDK dependency — if the package is missing
      // or misconfigured, only this method fails, not the import of this module.
      const { ZgFile, Indexer, getFlowContract } = await import('@0glabs/0g-ts-sdk');
      const { ethers } = await import('ethers');

      const provider = new ethers.JsonRpcProvider(this.config.rpc);
      const signer = new ethers.Wallet(this.config.privateKey, provider);
      const indexer = new Indexer(this.config.indexer);

      const client: OGStorageClient = { ZgFile, indexer, signer, provider, getFlowContract };
      this._client = client;
      return client;
    } catch (err) {
      throw new Error(`OGMemoryAdapter: failed to initialize 0G Storage client: ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: KV read/write via 0G Storage
  // ---------------------------------------------------------------------------

  /**
   * Reads a value from 0G Storage KV by key.
   * Returns null if the key has no stored data.
   *
   * 0G-native: Data is retrieved from the decentralized indexer — same result
   * from any machine with the same wallet.
   */
  private async _kvGet(key: string): Promise<Uint8Array | null> {
    const client = await this._getClient();
    try {
      // The 0G Storage indexer is used to locate and download the data segment
      // associated with this key. Keys are encoded as UTF-8 and used as the
      // content identifier.
      const keyBytes = new TextEncoder().encode(key);
      // TODO(feat/0g-memory-adapter): Replace with actual 0g-ts-sdk KV read API
      // once API shape is confirmed against testnet. Current SDK (0.3.3) exposes
      // upload/download via Indexer; KV namespace will be implemented as a
      // content-addressed segment with a deterministic root hash per key.
      void client; // suppress unused warning until SDK call is wired
      void keyBytes;
      throw new Error('OGMemoryAdapter._kvGet: 0G SDK integration pending testnet validation');
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) return null;
      throw new Error(`OGMemoryAdapter: KV read failed for key "${key}": ${String(err)}`);
    }
  }

  /**
   * Writes a value to 0G Storage KV by key.
   *
   * 0G-native: Data is uploaded to 0G Storage and pinned via the flow contract.
   * The root hash is deterministic for the same content — enabling deduplication.
   */
  private async _kvSet(key: string, value: Uint8Array): Promise<void> {
    const client = await this._getClient();
    try {
      void client; // suppress unused warning until SDK call is wired
      void key;
      void value;
      throw new Error('OGMemoryAdapter._kvSet: 0G SDK integration pending testnet validation');
    } catch (err) {
      throw new Error(`OGMemoryAdapter: KV write failed for key "${key}": ${String(err)}`);
    }
  }

  /**
   * Appends a value to a 0G Storage Log by key.
   * The Log Store is append-only — existing entries are immutable.
   *
   * 0G-native: This is the replayable execution history primitive.
   * Any agent with the same wallet can reconstruct full conversation history
   * by replaying the log from genesis.
   */
  private async _logAppend(key: string, value: Uint8Array): Promise<void> {
    const client = await this._getClient();
    try {
      void client;
      void key;
      void value;
      throw new Error('OGMemoryAdapter._logAppend: 0G SDK integration pending testnet validation');
    } catch (err) {
      throw new Error(`OGMemoryAdapter: Log append failed for key "${key}": ${String(err)}`);
    }
  }

  /**
   * Reads all entries from a 0G Storage Log by key, in order.
   * Returns an empty array if the log has no entries.
   */
  private async _logRead(key: string): Promise<Uint8Array[]> {
    const client = await this._getClient();
    try {
      void client;
      void key;
      throw new Error('OGMemoryAdapter._logRead: 0G SDK integration pending testnet validation');
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) return [];
      throw new Error(`OGMemoryAdapter: Log read failed for key "${key}": ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // IMemoryAdapter — KV session state
  // ---------------------------------------------------------------------------

  async saveSession(session: AgentSession): Promise<void> {
    // Write session state to KV
    await this._kvSet(sessionKey(session.agentId, session.sessionId), encode(session));

    // Update the session index for this agent (read-modify-write under best-effort)
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
    // Remove from index (read-modify-write)
    const existing = await this._kvGet(sessionIndexKey(agentId));
    if (existing !== null) {
      const ids = decode<string[]>(existing).filter((id) => id !== sessionId);
      await this._kvSet(sessionIndexKey(agentId), encode(ids));
    }
    // KV entries in 0G Storage are content-addressed — "deletion" means removing
    // the key from our index. The underlying data segment may persist on the
    // network until it expires per the storage contract.
    // No explicit delete call is needed (and 0G Storage has no delete API).
  }

  // ---------------------------------------------------------------------------
  // IMemoryAdapter — Log append-only history
  // ---------------------------------------------------------------------------

  async appendMessage(
    agentId: string,
    sessionId: string,
    message: SessionMessage,
  ): Promise<void> {
    // 0G-native: each message is a discrete log entry — immutable, ordered,
    // replayable. This is what makes agent execution verifiable and portable.
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

// ---------------------------------------------------------------------------
// Internal type — shape of the initialized 0G SDK client bundle
// ---------------------------------------------------------------------------

interface OGStorageClient {
  ZgFile: unknown;
  indexer: unknown;
  signer: unknown;
  provider: unknown;
  getFlowContract: unknown;
}
