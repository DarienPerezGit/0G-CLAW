export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface AgentSession {
  sessionId: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  metadata: Record<string, string>;
}

/**
 * Contract for all memory backends (0G Storage, local filesystem, etc.).
 *
 * KV methods (saveSession, loadSession, listSessions, deleteSession, saveConfig, loadConfig)
 * operate on mutable key-value state.
 *
 * Log methods (appendMessage, loadHistory) operate on append-only history.
 * Implementations MUST preserve append-only semantics — no edits, no deletes.
 *
 * All methods are async. Every implementation must handle unavailability
 * by rejecting the returned Promise with a descriptive Error.
 */
export interface IMemoryAdapter {
  /**
   * Persists the full session state under key `session:{agentId}:{sessionId}`.
   * Overwrites any existing value for that key.
   */
  saveSession(session: AgentSession): Promise<void>;

  /**
   * Retrieves session state by agentId and sessionId.
   * Returns null if the session does not exist.
   */
  loadSession(agentId: string, sessionId: string): Promise<AgentSession | null>;

  /**
   * Returns all sessionIds associated with a given agentId.
   * Returns an empty array if the agent has no sessions.
   */
  listSessions(agentId: string): Promise<string[]>;

  /**
   * Removes session state for the given agentId + sessionId.
   * No-op if the session does not exist.
   */
  deleteSession(agentId: string, sessionId: string): Promise<void>;

  /**
   * Appends a message to the immutable history log for a session.
   * Implementations must NOT allow mutation of existing entries.
   */
  appendMessage(agentId: string, sessionId: string, message: SessionMessage): Promise<void>;

  /**
   * Returns the full ordered message history for a session from the log.
   * Returns an empty array if no history exists.
   */
  loadHistory(agentId: string, sessionId: string): Promise<SessionMessage[]>;

  /**
   * Stores the agent configuration blob (e.g. AGENTS.md content) under key `config:{agentId}`.
   */
  saveConfig(agentId: string, config: string): Promise<void>;

  /**
   * Retrieves the agent configuration blob.
   * Returns null if no config has been stored for this agentId.
   */
  loadConfig(agentId: string): Promise<string | null>;
}
