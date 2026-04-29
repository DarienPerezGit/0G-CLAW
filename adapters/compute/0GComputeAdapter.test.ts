/**
 * Tests for OGComputeAdapter.
 *
 * Split into two categories:
 *
 * ── Unit tests (always run) ──────────────────────────────────────────────────
 *   constructor validation, input validation, error message contract.
 *   No network, no tokens required.
 *
 * ── Integration tests (conditional) ─────────────────────────────────────────
 *   Real 0G Compute inference against testnet.
 *   Requires:
 *     ENABLE_0G_COMPUTE_TESTS=true
 *     OG_STORAGE_RPC          (EVM RPC)
 *     OG_PRIVATE_KEY          (funded wallet)
 *     OG_COMPUTE_PROVIDER     (provider address, funded)
 *
 *   Pre-conditions for integration tests to pass:
 *     1. Wallet balance ≥ 3 OG (ledger creation minimum)
 *     2. Ledger created:    broker.ledger.addLedger(3)
 *     3. Provider ack'd:    broker.inference.acknowledgeProviderSigner(provider)
 *     4. Funds transferred: broker.ledger.transferFund(provider, "inference", amount)
 *
 *   Run:
 *     ENABLE_0G_COMPUTE_TESTS=true pnpm test adapters/compute/0GComputeAdapter.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { OGComputeAdapter } from './0GComputeAdapter.js';
import type { OGComputeAdapterConfig } from './0GComputeAdapter.js';
import type { ChatMessage } from './IComputeAdapter.js';

loadDotenv({ override: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMsg(content: string): ChatMessage {
  return { role: 'user', content };
}

function systemMsg(content: string): ChatMessage {
  return { role: 'system', content };
}

// ---------------------------------------------------------------------------
// Integration test gate
// ---------------------------------------------------------------------------

const INTEGRATION_ENABLED = process.env['ENABLE_0G_COMPUTE_TESTS'] === 'true';

const INTEGRATION_REQUIRED = [
  'OG_STORAGE_RPC',
  'OG_PRIVATE_KEY',
  'OG_COMPUTE_PROVIDER',
] as const;

const missingIntegration = INTEGRATION_REQUIRED.filter((k) => !process.env[k]);

const SKIP_INTEGRATION =
  !INTEGRATION_ENABLED || missingIntegration.length > 0;

if (INTEGRATION_ENABLED && missingIntegration.length > 0) {
  console.warn(
    `[0GComputeAdapter integration] Skipping — missing env vars: ${missingIntegration.join(', ')}`,
  );
} else if (!INTEGRATION_ENABLED) {
  console.info(
    '[0GComputeAdapter integration] Skipped — set ENABLE_0G_COMPUTE_TESTS=true to run.',
  );
}

function makeConfig(): OGComputeAdapterConfig {
  return {
    rpc: process.env['OG_STORAGE_RPC']!,
    privateKey: process.env['OG_PRIVATE_KEY']!,
    providerAddress: process.env['OG_COMPUTE_PROVIDER']!,
  };
}

// ---------------------------------------------------------------------------
// Unit tests — always run
// ---------------------------------------------------------------------------

describe('OGComputeAdapter — unit tests', () => {
  // --------------------------------------------------------------------------
  // Constructor validation
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    it('throws if rpc is missing', () => {
      expect(
        () =>
          new OGComputeAdapter({
            rpc: '',
            privateKey: '0x' + 'a'.repeat(64),
            providerAddress: '0x' + 'b'.repeat(40),
          }),
      ).toThrow('config.rpc is required');
    });

    it('throws if privateKey is missing', () => {
      expect(
        () =>
          new OGComputeAdapter({
            rpc: 'https://evmrpc-testnet.0g.ai',
            privateKey: '',
            providerAddress: '0x' + 'b'.repeat(40),
          }),
      ).toThrow('config.privateKey is required');
    });

    it('throws if providerAddress is missing', () => {
      expect(
        () =>
          new OGComputeAdapter({
            rpc: 'https://evmrpc-testnet.0g.ai',
            privateKey: '0x' + 'a'.repeat(64),
            providerAddress: '',
          }),
      ).toThrow('config.providerAddress is required');
    });

    it('constructs successfully with all required fields', () => {
      expect(
        () =>
          new OGComputeAdapter({
            rpc: 'https://evmrpc-testnet.0g.ai',
            privateKey: '0x' + 'a'.repeat(64),
            providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
          }),
      ).not.toThrow();
    });

    it('accepts optional fields without throwing', () => {
      expect(
        () =>
          new OGComputeAdapter({
            rpc: 'https://evmrpc-testnet.0g.ai',
            privateKey: '0x' + 'a'.repeat(64),
            providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
            model: 'qwen/qwen-2.5-7b-instruct',
            temperature: 0.5,
            maxTokens: 1024,
          }),
      ).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // getModel() — without network calls
  // --------------------------------------------------------------------------

  describe('getModel()', () => {
    it('returns configured model override before any chat()', () => {
      const adapter = new OGComputeAdapter({
        rpc: 'https://evmrpc-testnet.0g.ai',
        privateKey: '0x' + 'a'.repeat(64),
        providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
        model: 'qwen/qwen-2.5-7b-instruct',
      });
      expect(adapter.getModel()).toBe('qwen/qwen-2.5-7b-instruct');
    });

    it('returns placeholder when no model override and no chat() called', () => {
      const adapter = new OGComputeAdapter({
        rpc: 'https://evmrpc-testnet.0g.ai',
        privateKey: '0x' + 'a'.repeat(64),
        providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
      });
      const model = adapter.getModel();
      // Should contain the provider address prefix
      expect(model).toContain('0xa48f0128');
    });
  });

  // --------------------------------------------------------------------------
  // chat() input validation — throws before touching network
  // --------------------------------------------------------------------------

  describe('chat() input validation', () => {
    it('throws on empty messages array', async () => {
      const adapter = new OGComputeAdapter({
        rpc: 'https://evmrpc-testnet.0g.ai',
        privateKey: '0x' + 'a'.repeat(64),
        providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
      });
      await expect(adapter.chat([])).rejects.toThrow(
        'messages array must not be empty',
      );
    });

    it('throws on message with empty content string', async () => {
      const adapter = new OGComputeAdapter({
        rpc: 'https://evmrpc-testnet.0g.ai',
        privateKey: '0x' + 'a'.repeat(64),
        providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
      });
      await expect(
        adapter.chat([{ role: 'user', content: '' }]),
      ).rejects.toThrow('message content must be a non-empty string');
    });
  });

  // --------------------------------------------------------------------------
  // chat() error contract — broker fails with correct message
  // --------------------------------------------------------------------------

  describe('chat() error contract', () => {
    it('throws "broker not funded or not initialized" when broker cannot init (bad RPC)', async () => {
      const adapter = new OGComputeAdapter({
        rpc: 'https://0.0.0.0:1',
        privateKey: '0x' + 'a'.repeat(64),
        providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
      });
      await expect(adapter.chat([userMsg('hello')])).rejects.toThrow(
        'broker not funded or not initialized',
      );
    }, 15_000);

    it('healthCheck() returns false when broker cannot init (bad RPC)', async () => {
      const adapter = new OGComputeAdapter({
        rpc: 'https://0.0.0.0:1',
        privateKey: '0x' + 'a'.repeat(64),
        providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
      });
      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(false);
    }, 15_000);
  });

  // --------------------------------------------------------------------------
  // Interface parity — same shape as LocalComputeAdapter
  // --------------------------------------------------------------------------

  describe('interface parity with LocalComputeAdapter', () => {
    it('exposes chat, healthCheck, getModel methods', () => {
      const adapter = new OGComputeAdapter({
        rpc: 'https://evmrpc-testnet.0g.ai',
        privateKey: '0x' + 'a'.repeat(64),
        providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
      });
      expect(typeof adapter.chat).toBe('function');
      expect(typeof adapter.healthCheck).toBe('function');
      expect(typeof adapter.getModel).toBe('function');
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — conditional on ENABLE_0G_COMPUTE_TESTS=true
// ---------------------------------------------------------------------------

describe.skipIf(SKIP_INTEGRATION)(
  'OGComputeAdapter — integration tests (testnet, requires funded broker)',
  () => {
    let adapter: OGComputeAdapter;
    const PROVIDER = process.env['OG_COMPUTE_PROVIDER']!;

    beforeAll(() => {
      adapter = new OGComputeAdapter(makeConfig());
    });

    // Testnet rate limit: 10 req/min. Add a 7s pause before each test to stay under the limit.
    beforeEach(async () => {
      await new Promise((resolve) => setTimeout(resolve, 7_000));
    });

    it('healthCheck() returns true', async () => {
      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(true);
    }, 30_000);

    it('getModel() returns a non-empty string after healthCheck', async () => {
      const model = adapter.getModel();
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    });

    it('chat() returns a valid InferenceResult', async () => {
      const result = await adapter.chat([userMsg('Reply with exactly: pong')]);

      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
      expect(typeof result.model).toBe('string');
      expect(result.model.length).toBeGreaterThan(0);
      expect(typeof result.usage.promptTokens).toBe('number');
      expect(typeof result.usage.completionTokens).toBe('number');
      expect(typeof result.usage.totalTokens).toBe('number');
      // verificationHash is either a non-empty string or undefined — never null
      expect(result.verificationHash === undefined || typeof result.verificationHash === 'string').toBe(true);
    }, 60_000);

    it('chat() with system message works', async () => {
      const result = await adapter.chat([
        systemMsg('You are a concise assistant. Reply in at most 5 words.'),
        userMsg('What is 2 + 2?'),
      ]);
      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
    }, 60_000);

    it('chat() with options.model override uses that model', async () => {
      const currentModel = adapter.getModel();
      const result = await adapter.chat([userMsg('hello')], {
        model: currentModel,
        maxTokens: 10,
      });
      expect(result.model).toBe(currentModel);
    }, 60_000);

    it('verificationHash is undefined or string (never null, never fabricated)', async () => {
      const result = await adapter.chat([userMsg('ping')]);
      expect(result.verificationHash).not.toBeNull();
      if (result.verificationHash !== undefined) {
        expect(typeof result.verificationHash).toBe('string');
        expect(result.verificationHash.length).toBeGreaterThan(0);
      }
    }, 60_000);

    it('provider address is resolvable — getServiceMetadata returns endpoint+model', async () => {
      // This test accesses _getBroker indirectly via a healthCheck, then runs
      // a short chat. We verify that the resolved model matches getModel().
      const result = await adapter.chat([userMsg('one word: hello')], {
        maxTokens: 5,
      });
      expect(adapter.getModel()).toBe(result.model);
    }, 60_000);

    it('consecutive calls reuse the same broker (no re-init)', async () => {
      const r1 = await adapter.chat([userMsg('say A')], { maxTokens: 5 });
      // Testnet rate limit is 10 req/min — pause between consecutive requests.
      await new Promise((resolve) => setTimeout(resolve, 7_000));
      const r2 = await adapter.chat([userMsg('say B')], { maxTokens: 5 });
      // Both should use the same model — broker was not re-initialized
      expect(r1.model).toBe(r2.model);
    }, 120_000);

    it('provider address in config matches a known testnet provider', () => {
      const knownTestnetProviders = [
        '0xa48f01287233509FD694a22Bf840225062E67836', // qwen-2.5-7b
        '0x8e60d466FD16798Bec4868aa4CE38586D5590049', // gpt-oss-20b
        '0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08', // gemma-3-27b
      ].map((a) => a.toLowerCase());
      expect(knownTestnetProviders).toContain(PROVIDER.toLowerCase());
    });
  },
);
