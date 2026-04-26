/**
 * Integration tests for OGMemoryAdapter — step 1: _kvSet + _kvGet.
 *
 * These tests run against the 0G testnet (NOT mocks).
 * Per CLAUDE.md: "Un test que pasa con mocks pero falla contra testnet no cuenta."
 *
 * Required env vars (in .env):
 *   OG_STORAGE_RPC
 *   OG_STORAGE_INDEXER
 *   OG_PRIVATE_KEY
 *
 * Skip gracefully if not configured:
 *   All tests are skipped if any required env var is missing.
 *
 * Run:
 *   pnpm test adapters/memory/0GMemoryAdapter.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { OGMemoryAdapter } from './0GMemoryAdapter.js';
import type { OGMemoryAdapterConfig } from './0GMemoryAdapter.js';
import type { AgentSession } from './IMemoryAdapter.js';

// Load .env before reading process.env.
// override: true ensures .env values replace any empty/stale vars already in process.env.
loadDotenv({ override: true });

// ---------------------------------------------------------------------------
// Env-var validation — skip all tests if not configured
// ---------------------------------------------------------------------------

const REQUIRED = [
  'OG_STORAGE_RPC',
  'OG_STORAGE_INDEXER',
  'OG_PRIVATE_KEY',
] as const;

const missing = REQUIRED.filter((k) => !process.env[k]);
const SKIP = missing.length > 0;

if (SKIP) {
  console.warn(
    `[0GMemoryAdapter tests] Skipping — missing env vars: ${missing.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): OGMemoryAdapterConfig {
  return {
    rpc: process.env['OG_STORAGE_RPC']!,
    indexer: process.env['OG_STORAGE_INDEXER']!,
    privateKey: process.env['OG_PRIVATE_KEY']!,
    // streamId omitted — derived from wallet address automatically
    // cacheDir omitted — defaults to ~/.0g-claw/cache (shared between instances)
  };
}

/** Unique suffix per test run to avoid key collisions across runs */
const RUN_ID = Date.now().toString(36);

function makeSession(agentId: string, sessionId: string): AgentSession {
  return {
    sessionId,
    agentId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    metadata: { test: 'true', runId: RUN_ID },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('OGMemoryAdapter — KV round-trip (testnet)', () => {
  let adapter: OGMemoryAdapter;
  const AGENT = `test-agent-${RUN_ID}`;

  beforeAll(() => {
    adapter = new OGMemoryAdapter(makeConfig());
  });

  // --------------------------------------------------------------------------
  // Constructor validation
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    it('throws if rpc is missing', () => {
      expect(
        () => new OGMemoryAdapter({ ...makeConfig(), rpc: '' }),
      ).toThrow('config.rpc is required');
    });

    it('throws if indexer is missing', () => {
      expect(
        () => new OGMemoryAdapter({ ...makeConfig(), indexer: '' }),
      ).toThrow('config.indexer is required');
    });

    it('throws if privateKey is missing', () => {
      expect(
        () => new OGMemoryAdapter({ ...makeConfig(), privateKey: '' }),
      ).toThrow('config.privateKey is required');
    });

    it('constructs successfully with minimal valid config', () => {
      expect(() => new OGMemoryAdapter(makeConfig())).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // saveConfig / loadConfig — simplest KV round-trip
  // --------------------------------------------------------------------------

  describe('saveConfig / loadConfig', () => {
    it('writes config and reads it back', async () => {
      const configValue = `{"model":"qwen3","runId":"${RUN_ID}"}`;
      await adapter.saveConfig(AGENT, configValue);
      const loaded = await adapter.loadConfig(AGENT);
      expect(loaded).toBe(configValue);
    }, 120_000); // 2 min — on-chain tx can be slow

    it('returns null for agent with no config', async () => {
      const freshAgent = `fresh-${RUN_ID}`;
      const result = await adapter.loadConfig(freshAgent);
      expect(result).toBeNull();
    }, 30_000);
  });

  // --------------------------------------------------------------------------
  // saveSession / loadSession
  // --------------------------------------------------------------------------

  describe('saveSession / loadSession', () => {
    it('saves a session and loads it back', async () => {
      const session = makeSession(AGENT, `sess-${RUN_ID}-a`);
      await adapter.saveSession(session);
      const loaded = await adapter.loadSession(AGENT, session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(session.sessionId);
      expect(loaded!.agentId).toBe(AGENT);
      expect(loaded!.metadata['runId']).toBe(RUN_ID);
    }, 120_000);

    it('returns null for unknown sessionId', async () => {
      const result = await adapter.loadSession(AGENT, `nonexistent-${RUN_ID}`);
      expect(result).toBeNull();
    }, 30_000);

    it('overwrites existing session on re-save', async () => {
      const session = makeSession(AGENT, `sess-${RUN_ID}-overwrite`);
      await adapter.saveSession(session);

      const updated: AgentSession = {
        ...session,
        updatedAt: Date.now() + 1000,
        metadata: { ...session.metadata, updated: 'yes' },
      };
      await adapter.saveSession(updated);

      const loaded = await adapter.loadSession(AGENT, session.sessionId);
      expect(loaded!.metadata['updated']).toBe('yes');
    }, 120_000);
  });

  // --------------------------------------------------------------------------
  // listSessions
  // --------------------------------------------------------------------------

  describe('listSessions', () => {
    it('lists sessions saved under an agent', async () => {
      const agentForList = `list-agent-${RUN_ID}`;
      const ids = [`s1-${RUN_ID}`, `s2-${RUN_ID}`];

      for (const id of ids) {
        await adapter.saveSession(makeSession(agentForList, id));
      }

      const listed = await adapter.listSessions(agentForList);
      expect(listed).toContain(ids[0]);
      expect(listed).toContain(ids[1]);
    }, 180_000); // multiple writes

    it('returns empty array for agent with no sessions', async () => {
      const result = await adapter.listSessions(`empty-${RUN_ID}`);
      expect(result).toEqual([]);
    }, 30_000);
  });

  // --------------------------------------------------------------------------
  // deleteSession
  // --------------------------------------------------------------------------

  describe('deleteSession', () => {
    it('removes session from index after delete', async () => {
      const agentForDel = `del-agent-${RUN_ID}`;
      const sessionId = `del-sess-${RUN_ID}`;

      await adapter.saveSession(makeSession(agentForDel, sessionId));
      let listed = await adapter.listSessions(agentForDel);
      expect(listed).toContain(sessionId);

      await adapter.deleteSession(agentForDel, sessionId);
      listed = await adapter.listSessions(agentForDel);
      expect(listed).not.toContain(sessionId);
    }, 180_000);

    it('is safe to call on non-existent session', async () => {
      await expect(
        adapter.deleteSession(AGENT, `ghost-${RUN_ID}`),
      ).resolves.toBeUndefined();
    }, 30_000);
  });

  // --------------------------------------------------------------------------
  // Cross-instance portability (0G-native: same wallet → same state)
  // --------------------------------------------------------------------------

  describe('portability', () => {
    it('second adapter instance reads state written by first (same wallet)', async () => {
      const portAgent = `port-agent-${RUN_ID}`;
      const portSession = makeSession(portAgent, `port-sess-${RUN_ID}`);

      // Write with first instance
      await adapter.saveSession(portSession);
      await adapter.saveConfig(portAgent, `portable-config-${RUN_ID}`);

      // Read with a NEW instance using the same credentials
      const adapter2 = new OGMemoryAdapter(makeConfig());
      const loaded = await adapter2.loadSession(portAgent, portSession.sessionId);
      const cfg = await adapter2.loadConfig(portAgent);

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(portSession.sessionId);
      expect(cfg).toBe(`portable-config-${RUN_ID}`);
    }, 180_000);
  });
});
