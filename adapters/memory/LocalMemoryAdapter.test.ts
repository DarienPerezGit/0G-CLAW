import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalMemoryAdapter } from './LocalMemoryAdapter.js';
import type { AgentSession, SessionMessage } from './IMemoryAdapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: 'sess-1',
    agentId: 'agent-1',
    createdAt: 1000,
    updatedAt: 1000,
    messages: [],
    metadata: {},
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    role: 'user',
    content: 'hello',
    timestamp: 2000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup — isolated temp directory per test run
// ---------------------------------------------------------------------------

let tmpDir: string;
let adapter: LocalMemoryAdapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), '0g-claw-test-'));
  adapter = new LocalMemoryAdapter({ storageDir: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// saveSession / loadSession
// ---------------------------------------------------------------------------

describe('saveSession / loadSession', () => {
  it('persists and retrieves a session', async () => {
    const session = makeSession();
    await adapter.saveSession(session);
    const loaded = await adapter.loadSession(session.agentId, session.sessionId);
    expect(loaded).toEqual(session);
  });

  it('returns null for a non-existent session', async () => {
    const result = await adapter.loadSession('ghost-agent', 'ghost-session');
    expect(result).toBeNull();
  });

  it('overwrites an existing session on second save', async () => {
    const session = makeSession();
    await adapter.saveSession(session);
    const updated = { ...session, updatedAt: 9999, metadata: { key: 'val' } };
    await adapter.saveSession(updated);
    const loaded = await adapter.loadSession(session.agentId, session.sessionId);
    expect(loaded?.updatedAt).toBe(9999);
    expect(loaded?.metadata).toEqual({ key: 'val' });
  });

  it('stores multiple sessions for the same agent independently', async () => {
    const s1 = makeSession({ sessionId: 'sess-1' });
    const s2 = makeSession({ sessionId: 'sess-2', updatedAt: 5000 });
    await adapter.saveSession(s1);
    await adapter.saveSession(s2);
    expect(await adapter.loadSession('agent-1', 'sess-1')).toEqual(s1);
    expect(await adapter.loadSession('agent-1', 'sess-2')).toEqual(s2);
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('listSessions', () => {
  it('returns empty array when agent has no sessions', async () => {
    const result = await adapter.listSessions('no-such-agent');
    expect(result).toEqual([]);
  });

  it('returns all session IDs for an agent', async () => {
    await adapter.saveSession(makeSession({ sessionId: 'sess-a' }));
    await adapter.saveSession(makeSession({ sessionId: 'sess-b' }));
    await adapter.saveSession(makeSession({ sessionId: 'sess-c' }));
    const ids = await adapter.listSessions('agent-1');
    expect(ids.sort()).toEqual(['sess-a', 'sess-b', 'sess-c']);
  });

  it('does not include sessions from a different agent', async () => {
    await adapter.saveSession(makeSession({ agentId: 'agent-1', sessionId: 'sess-1' }));
    await adapter.saveSession(makeSession({ agentId: 'agent-2', sessionId: 'sess-2' }));
    expect(await adapter.listSessions('agent-1')).toEqual(['sess-1']);
    expect(await adapter.listSessions('agent-2')).toEqual(['sess-2']);
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe('deleteSession', () => {
  it('removes an existing session', async () => {
    await adapter.saveSession(makeSession());
    await adapter.deleteSession('agent-1', 'sess-1');
    expect(await adapter.loadSession('agent-1', 'sess-1')).toBeNull();
  });

  it('is a no-op for a non-existent session', async () => {
    await expect(adapter.deleteSession('ghost', 'ghost-sess')).resolves.toBeUndefined();
  });

  it('does not affect other sessions on delete', async () => {
    await adapter.saveSession(makeSession({ sessionId: 'sess-keep' }));
    await adapter.saveSession(makeSession({ sessionId: 'sess-del' }));
    await adapter.deleteSession('agent-1', 'sess-del');
    expect(await adapter.loadSession('agent-1', 'sess-keep')).not.toBeNull();
    expect(await adapter.loadSession('agent-1', 'sess-del')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// appendMessage / loadHistory
// ---------------------------------------------------------------------------

describe('appendMessage / loadHistory', () => {
  it('returns empty array when no history exists', async () => {
    const result = await adapter.loadHistory('agent-1', 'sess-1');
    expect(result).toEqual([]);
  });

  it('appends and retrieves messages in order', async () => {
    const m1 = makeMessage({ content: 'first', timestamp: 100 });
    const m2 = makeMessage({ role: 'assistant', content: 'second', timestamp: 200 });
    const m3 = makeMessage({ content: 'third', timestamp: 300 });
    await adapter.appendMessage('agent-1', 'sess-1', m1);
    await adapter.appendMessage('agent-1', 'sess-1', m2);
    await adapter.appendMessage('agent-1', 'sess-1', m3);
    const history = await adapter.loadHistory('agent-1', 'sess-1');
    expect(history).toEqual([m1, m2, m3]);
  });

  it('preserves append-only semantics — prior entries are unchanged after new append', async () => {
    const m1 = makeMessage({ content: 'original', timestamp: 1 });
    await adapter.appendMessage('agent-1', 'sess-1', m1);
    const beforeAppend = await adapter.loadHistory('agent-1', 'sess-1');

    const m2 = makeMessage({ content: 'new', timestamp: 2 });
    await adapter.appendMessage('agent-1', 'sess-1', m2);
    const afterAppend = await adapter.loadHistory('agent-1', 'sess-1');

    // first entry must be identical
    expect(afterAppend[0]).toEqual(beforeAppend[0]);
    expect(afterAppend).toHaveLength(2);
  });

  it('keeps histories isolated per session', async () => {
    await adapter.appendMessage('agent-1', 'sess-A', makeMessage({ content: 'A' }));
    await adapter.appendMessage('agent-1', 'sess-B', makeMessage({ content: 'B' }));
    expect(await adapter.loadHistory('agent-1', 'sess-A')).toHaveLength(1);
    expect((await adapter.loadHistory('agent-1', 'sess-A'))[0]?.content).toBe('A');
    expect((await adapter.loadHistory('agent-1', 'sess-B'))[0]?.content).toBe('B');
  });

  it('cross-instance replay: new adapter instance with same storageDir reads same history', async () => {
    const m1 = makeMessage({ content: 'msg-1', timestamp: 1 });
    const m2 = makeMessage({ role: 'assistant', content: 'msg-2', timestamp: 2 });
    const m3 = makeMessage({ content: 'msg-3', timestamp: 3 });
    await adapter.appendMessage('agent-1', 'sess-1', m1);
    await adapter.appendMessage('agent-1', 'sess-1', m2);
    await adapter.appendMessage('agent-1', 'sess-1', m3);

    // Simulate a different process / machine by creating a brand-new adapter instance
    // pointing at the same storageDir (same wallet = same dir in real 0G scenario).
    const adapter2 = new LocalMemoryAdapter({ storageDir: tmpDir });
    const history = await adapter2.loadHistory('agent-1', 'sess-1');

    expect(history).toHaveLength(3);
    expect(history[0]).toEqual(m1);
    expect(history[1]).toEqual(m2);
    expect(history[2]).toEqual(m3);
  });

  it('skips corrupt lines and returns valid messages (option A)', async () => {
    // Write valid + corrupt lines directly to the JSONL file
    const historyFile = path.join(tmpDir, 'agent-1', 'history', 'sess-corrupt.jsonl');
    await fs.mkdir(path.dirname(historyFile), { recursive: true });
    const validMsg = makeMessage({ content: 'valid', timestamp: 10 });
    await fs.writeFile(
      historyFile,
      `${JSON.stringify(validMsg)}\n{CORRUPT_LINE\n${JSON.stringify(makeMessage({ content: 'also valid', timestamp: 20 }))}\n`,
      'utf-8',
    );

    const history = await adapter.loadHistory('agent-1', 'sess-corrupt');
    expect(history).toHaveLength(2);
    expect(history[0]?.content).toBe('valid');
    expect(history[1]?.content).toBe('also valid');
  });
});

// ---------------------------------------------------------------------------
// saveConfig / loadConfig
// ---------------------------------------------------------------------------

describe('saveConfig / loadConfig', () => {
  it('persists and retrieves config', async () => {
    await adapter.saveConfig('agent-1', '# My agent config');
    const config = await adapter.loadConfig('agent-1');
    expect(config).toBe('# My agent config');
  });

  it('returns null when no config exists', async () => {
    expect(await adapter.loadConfig('no-agent')).toBeNull();
  });

  it('overwrites config on second save', async () => {
    await adapter.saveConfig('agent-1', 'first version');
    await adapter.saveConfig('agent-1', 'second version');
    expect(await adapter.loadConfig('agent-1')).toBe('second version');
  });

  it('keeps configs isolated per agent', async () => {
    await adapter.saveConfig('agent-1', 'config-1');
    await adapter.saveConfig('agent-2', 'config-2');
    expect(await adapter.loadConfig('agent-1')).toBe('config-1');
    expect(await adapter.loadConfig('agent-2')).toBe('config-2');
  });
});
