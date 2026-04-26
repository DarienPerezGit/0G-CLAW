import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {
  IMemoryAdapter,
  AgentSession,
  SessionMessage,
} from './IMemoryAdapter.js';

export interface LocalMemoryAdapterConfig {
  /**
   * Root directory for all stored agent data.
   * Defaults to `~/.0g-claw` if not provided.
   */
  storageDir?: string;
}

/**
 * Filesystem-based fallback implementation of IMemoryAdapter.
 *
 * Layout on disk:
 *   <storageDir>/
 *     <agentId>/
 *       config.txt                        ← saveConfig / loadConfig
 *       sessions/
 *         <sessionId>.json                ← saveSession / loadSession / listSessions / deleteSession
 *       history/
 *         <sessionId>.jsonl               ← appendMessage / loadHistory (append-only)
 *
 * The history files are strictly append-only. appendMessage never modifies
 * existing lines — it only appends. loadHistory reads all lines in order.
 */
export class LocalMemoryAdapter implements IMemoryAdapter {
  private readonly storageDir: string;

  constructor(config: LocalMemoryAdapterConfig = {}) {
    this.storageDir = config.storageDir ?? path.join(os.homedir(), '.0g-claw');
  }

  // ---------------------------------------------------------------------------
  // Internal path helpers
  // ---------------------------------------------------------------------------

  private sessionsDir(agentId: string): string {
    return path.join(this.storageDir, agentId, 'sessions');
  }

  private sessionPath(agentId: string, sessionId: string): string {
    return path.join(this.sessionsDir(agentId), `${sessionId}.json`);
  }

  private historyDir(agentId: string): string {
    return path.join(this.storageDir, agentId, 'history');
  }

  private historyPath(agentId: string, sessionId: string): string {
    return path.join(this.historyDir(agentId), `${sessionId}.jsonl`);
  }

  private configPath(agentId: string): string {
    return path.join(this.storageDir, agentId, 'config.txt');
  }

  // ---------------------------------------------------------------------------
  // KV — session state
  // ---------------------------------------------------------------------------

  async saveSession(session: AgentSession): Promise<void> {
    const dir = this.sessionsDir(session.agentId);
    await fs.mkdir(dir, { recursive: true });
    const dest = this.sessionPath(session.agentId, session.sessionId);
    const tmp = `${dest}.tmp`;
    // Write to a temp file first, then atomically rename to avoid partial writes
    // on process crash mid-write.
    await fs.writeFile(tmp, JSON.stringify(session, null, 2), 'utf-8');
    await fs.rename(tmp, dest);
  }

  async loadSession(agentId: string, sessionId: string): Promise<AgentSession | null> {
    const filePath = this.sessionPath(agentId, sessionId);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as AgentSession;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw new Error(
        `LocalMemoryAdapter: failed to load session "${sessionId}" for agent "${agentId}": ${String(err)}`,
      );
    }
  }

  async listSessions(agentId: string): Promise<string[]> {
    const dir = this.sessionsDir(agentId);
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -5)); // strip .json
    } catch (err) {
      if (isNotFoundError(err)) return [];
      throw new Error(
        `LocalMemoryAdapter: failed to list sessions for agent "${agentId}": ${String(err)}`,
      );
    }
  }

  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    const filePath = this.sessionPath(agentId, sessionId);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (isNotFoundError(err)) return; // no-op as per contract
      throw new Error(
        `LocalMemoryAdapter: failed to delete session "${sessionId}" for agent "${agentId}": ${String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Log — append-only history
  // ---------------------------------------------------------------------------

  async appendMessage(
    agentId: string,
    sessionId: string,
    message: SessionMessage,
  ): Promise<void> {
    const dir = this.historyDir(agentId);
    await fs.mkdir(dir, { recursive: true });
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(this.historyPath(agentId, sessionId), line, 'utf-8');
  }

  async loadHistory(agentId: string, sessionId: string): Promise<SessionMessage[]> {
    const filePath = this.historyPath(agentId, sessionId);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const messages: SessionMessage[] = [];
      for (const line of raw.split('\n')) {
        if (line.trim().length === 0) continue;
        try {
          messages.push(JSON.parse(line) as SessionMessage);
        } catch {
          // Option A: skip corrupt lines, prefer partial data over a demo crash.
          console.warn(
            `LocalMemoryAdapter: skipping corrupt history line for session "${sessionId}" agent "${agentId}": ${line.slice(0, 120)}`,
          );
        }
      }
      return messages;
    } catch (err) {
      if (isNotFoundError(err)) return [];
      throw new Error(
        `LocalMemoryAdapter: failed to load history for session "${sessionId}" agent "${agentId}": ${String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  async saveConfig(agentId: string, config: string): Promise<void> {
    const dir = path.join(this.storageDir, agentId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.configPath(agentId), config, 'utf-8');
  }

  async loadConfig(agentId: string): Promise<string | null> {
    try {
      return await fs.readFile(this.configPath(agentId), 'utf-8');
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw new Error(
        `LocalMemoryAdapter: failed to load config for agent "${agentId}": ${String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
