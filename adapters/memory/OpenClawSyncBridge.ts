import type { IMemoryAdapter, SessionMessage } from './IMemoryAdapter.js';

/**
 * Payload emitted by OpenClaw's onSessionTranscriptUpdate.
 * Matches the type in openclaw/src/sessions/transcript-events.ts.
 */
interface SessionTranscriptUpdate {
  sessionFile: string;
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
}

/**
 * Payload emitted by OpenClaw's onSessionLifecycleEvent.
 * Matches the type in openclaw/src/sessions/session-lifecycle-events.ts.
 */
interface SessionLifecycleEvent {
  sessionKey: string;
  reason: string;
  parentSessionKey?: string;
  label?: string;
  displayName?: string;
}

export interface OpenClawSyncBridgeConfig {
  /**
   * The memory adapter to mirror data into (0GMemoryAdapter or LocalMemoryAdapter).
   */
  adapter: IMemoryAdapter;

  /**
   * Agent ID to use when writing to the adapter.
   * Defaults to "default".
   */
  agentId?: string;

  /**
   * Called when a sync error occurs. Defaults to console.warn — never throws.
   * The bridge must never crash the OpenClaw process.
   */
  onError?: (context: string, err: unknown) => void;
}

/**
 * OpenClawSyncBridge subscribes to OpenClaw's internal event hooks and
 * mirrors session data to any IMemoryAdapter.
 *
 * This is the integration seam between OpenClaw core and 0G-Claw's
 * adapter layer. It does NOT modify any OpenClaw internals.
 *
 * Subscribed hooks:
 *   - onSessionTranscriptUpdate → appendMessage to adapter Log Store
 *   - onSessionLifecycleEvent   → create/reset session state in adapter KV
 *
 * 0G-native capability: when the adapter is 0GMemoryAdapter, every message
 * appended here becomes part of the replayable, portable agent execution log.
 *
 * Usage:
 *   const bridge = new OpenClawSyncBridge({ adapter: new OGMemoryAdapter(...) });
 *   await bridge.attach(); // call once at startup
 *   // ...
 *   bridge.detach(); // call on shutdown to unsubscribe
 */
export class OpenClawSyncBridge {
  private readonly adapter: IMemoryAdapter;
  private readonly agentId: string;
  private readonly onError: (context: string, err: unknown) => void;

  private _unsubTranscript: (() => void) | null = null;
  private _unsubLifecycle: (() => void) | null = null;

  constructor(config: OpenClawSyncBridgeConfig) {
    this.adapter = config.adapter;
    this.agentId = config.agentId ?? 'default';
    this.onError =
      config.onError ??
      ((context, err) => {
        console.warn(`OpenClawSyncBridge [${context}]:`, err);
      });
  }

  /**
   * Subscribes to OpenClaw's event hooks.
   * Safe to call multiple times — subsequent calls are no-ops if already attached.
   *
   * Dynamic import of openclaw event modules is used so that this bridge can
   * be loaded in environments where openclaw is not present (e.g. tests).
   */
  async attach(): Promise<void> {
    if (this._unsubTranscript !== null) return; // already attached

    let onSessionTranscriptUpdate: (listener: (u: SessionTranscriptUpdate) => void) => () => void;
    let onSessionLifecycleEvent: (listener: (e: SessionLifecycleEvent) => void) => () => void;

    try {
      // Use string variables to prevent tsc from statically resolving
      // openclaw's source files (which live outside our tsconfig include paths).
      const transcriptPath = '../../openclaw/src/sessions/transcript-events.js';
      const lifecyclePath = '../../openclaw/src/sessions/session-lifecycle-events.js';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transcriptMod = await (import(/* @vite-ignore */ transcriptPath) as Promise<any>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lifecycleMod = await (import(/* @vite-ignore */ lifecyclePath) as Promise<any>);
      onSessionTranscriptUpdate = transcriptMod.onSessionTranscriptUpdate;
      onSessionLifecycleEvent = lifecycleMod.onSessionLifecycleEvent;
    } catch (err) {
      throw new Error(
        `OpenClawSyncBridge: failed to import openclaw event hooks. ` +
        `Ensure the openclaw submodule is initialized: ${String(err)}`,
      );
    }

    this._unsubTranscript = onSessionTranscriptUpdate((update) => {
      this._handleTranscriptUpdate(update).catch((err) => {
        this.onError('transcript-update', err);
      });
    });

    this._unsubLifecycle = onSessionLifecycleEvent((event) => {
      this._handleLifecycleEvent(event).catch((err) => {
        this.onError('lifecycle-event', err);
      });
    });
  }

  /**
   * Unsubscribes from OpenClaw's event hooks.
   * Safe to call if not attached.
   */
  detach(): void {
    this._unsubTranscript?.();
    this._unsubLifecycle?.();
    this._unsubTranscript = null;
    this._unsubLifecycle = null;
  }

  // ---------------------------------------------------------------------------
  // Internal handlers
  // ---------------------------------------------------------------------------

  private async _handleTranscriptUpdate(update: SessionTranscriptUpdate): Promise<void> {
    const sessionId = update.sessionKey ?? this._deriveSessionIdFromFile(update.sessionFile);
    if (!sessionId) {
      this.onError('transcript-update', `Cannot derive sessionId from update: ${JSON.stringify(update)}`);
      return;
    }

    if (update.message === undefined) return; // header-only update, no message to mirror

    const message = this._normalizeMessage(update.message, update.messageId);
    if (message === null) return; // unrecognized format, skip silently

    await this.adapter.appendMessage(this.agentId, sessionId, message);
  }

  private async _handleLifecycleEvent(event: SessionLifecycleEvent): Promise<void> {
    const sessionId = event.sessionKey;
    const now = Date.now();

    // On session create/start: bootstrap the KV entry if it doesn't exist.
    // On reset: we do not delete — history is preserved (append-only principle).
    if (event.reason === 'create' || event.reason === 'start') {
      const existing = await this.adapter.loadSession(this.agentId, sessionId);
      if (existing === null) {
        await this.adapter.saveSession({
          sessionId,
          agentId: this.agentId,
          createdAt: now,
          updatedAt: now,
          messages: [],
          metadata: {
            label: event.label ?? '',
            displayName: event.displayName ?? '',
            ...(event.parentSessionKey
              ? { parentSessionKey: event.parentSessionKey }
              : {}),
          },
        });
      }
    }

    // On session end/done: update metadata with final timestamp.
    if (event.reason === 'done' || event.reason === 'end') {
      const existing = await this.adapter.loadSession(this.agentId, sessionId);
      if (existing !== null) {
        await this.adapter.saveSession({
          ...existing,
          updatedAt: now,
          metadata: { ...existing.metadata, endReason: event.reason },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Derives a sessionId from a .jsonl file path.
   * e.g. "/home/user/.openclaw/agents/default/sessions/abc123.jsonl" → "abc123"
   */
  private _deriveSessionIdFromFile(sessionFile: string): string | null {
    const base = sessionFile.split(/[/\\]/).pop() ?? '';
    if (!base.endsWith('.jsonl')) return null;
    return base.slice(0, -6); // strip ".jsonl"
  }

  /**
   * Normalizes an OpenClaw message object (shape: unknown) to SessionMessage.
   * Returns null if the message cannot be mapped to our schema.
   *
   * OpenClaw message shape (from transcript-events.ts analysis):
   * {
   *   role: "user" | "assistant",
   *   content: Array<{ type: "text", text: string } | ...>,
   *   model?: string,
   *   timestamp?: number,
   *   ...
   * }
   */
  private _normalizeMessage(raw: unknown, messageId?: string): SessionMessage | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const msg = raw as Record<string, unknown>;
    const role = msg['role'];
    if (role !== 'user' && role !== 'assistant' && role !== 'system') return null;

    // Extract text content from OpenClaw's content array format
    let content = '';
    if (typeof msg['content'] === 'string') {
      content = msg['content'];
    } else if (Array.isArray(msg['content'])) {
      content = (msg['content'] as Array<Record<string, unknown>>)
        .filter((part) => part['type'] === 'text')
        .map((part) => String(part['text'] ?? ''))
        .join('');
    }

    if (!content) return null;

    // messageId is an OpenClaw internal identifier — not part of IMemoryAdapter.SessionMessage.
    void messageId;

    return {
      role: role as 'user' | 'assistant' | 'system',
      content,
      timestamp: typeof msg['timestamp'] === 'number' ? msg['timestamp'] : Date.now(),
    };
  }
}
