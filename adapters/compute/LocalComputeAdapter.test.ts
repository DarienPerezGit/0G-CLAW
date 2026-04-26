import { describe, it, expect } from 'vitest';
import { LocalComputeAdapter } from './LocalComputeAdapter.js';
import type { ChatMessage } from './IComputeAdapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMsg(content: string): ChatMessage {
  return { role: 'user', content };
}

function systemMsg(content: string): ChatMessage {
  return { role: 'system', content };
}

function assistantMsg(content: string): ChatMessage {
  return { role: 'assistant', content };
}

// ---------------------------------------------------------------------------
// Basic execution
// ---------------------------------------------------------------------------

describe('basic execution', () => {
  it('returns a valid InferenceResult for a simple message', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('hello')]);
    expect(result).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('echoes the last user message with [local] prefix', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('what is 2+2?')]);
    expect(result.content).toBe('[local] what is 2+2?');
  });

  it('picks the last user message from a multi-turn conversation', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const messages: ChatMessage[] = [
      systemMsg('You are helpful.'),
      userMsg('first question'),
      assistantMsg('first answer'),
      userMsg('second question'),
    ];
    const result = await adapter.chat(messages);
    expect(result.content).toBe('[local] second question');
  });
});

// ---------------------------------------------------------------------------
// InferenceResult structure — field by field
// ---------------------------------------------------------------------------

describe('InferenceResult structure', () => {
  it('has all required top-level fields', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('test')]);
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('usage');
    expect(result).toHaveProperty('verificationHash');
  });

  it('verificationHash is explicitly undefined — not missing, not null, not a string', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('test')]);
    // 'verificationHash' in result ensures the key is present (not just undefined via absence)
    expect('verificationHash' in result).toBe(true);
    expect(result.verificationHash).toBeUndefined();
  });

  it('usage has promptTokens, completionTokens, totalTokens — all numbers > 0', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('hello world')]);
    expect(typeof result.usage.promptTokens).toBe('number');
    expect(typeof result.usage.completionTokens).toBe('number');
    expect(typeof result.usage.totalTokens).toBe('number');
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBe(
      result.usage.promptTokens + result.usage.completionTokens,
    );
  });

  it('model defaults to "local"', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('test')]);
    expect(result.model).toBe('local');
  });

  it('model can be overridden via constructor', async () => {
    const adapter = new LocalComputeAdapter({ model: 'qwen3.6-plus', simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('test')]);
    expect(result.model).toBe('qwen3.6-plus');
  });

  it('model can be overridden per-call via options', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([userMsg('test')], { model: 'GLM-5-FP8' });
    expect(result.model).toBe('GLM-5-FP8');
  });
});

// ---------------------------------------------------------------------------
// Simulated latency
// ---------------------------------------------------------------------------

describe('simulated latency', () => {
  it('takes at least simulatedLatencyMs to resolve', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 80 });
    const start = Date.now();
    await adapter.chat([userMsg('timing test')]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(75); // 5ms tolerance
  });
});

// ---------------------------------------------------------------------------
// Multiple calls — consistency
// ---------------------------------------------------------------------------

describe('multiple calls — consistency', () => {
  it('same input always produces same content output', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const r1 = await adapter.chat([userMsg('consistent?')]);
    const r2 = await adapter.chat([userMsg('consistent?')]);
    expect(r1.content).toBe(r2.content);
  });

  it('sequential calls do not interfere with each other', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const r1 = await adapter.chat([userMsg('call one')]);
    const r2 = await adapter.chat([userMsg('call two')]);
    expect(r1.content).toBe('[local] call one');
    expect(r2.content).toBe('[local] call two');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('throws on empty messages array', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    await expect(adapter.chat([])).rejects.toThrow(
      'LocalComputeAdapter: messages array must not be empty',
    );
  });

  it('throws on message with empty content string', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    await expect(adapter.chat([{ role: 'user', content: '' }])).rejects.toThrow(
      'LocalComputeAdapter: message content must be a non-empty string',
    );
  });

  it('handles a very long input without error', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const longContent = 'x'.repeat(10_000);
    const result = await adapter.chat([userMsg(longContent)]);
    expect(result.content).toBe(`[local] ${longContent}`);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
  });

  it('handles conversation with only system message (no user message)', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    const result = await adapter.chat([systemMsg('system only')]);
    expect(result.content).toBe('[local] (no user message found)');
  });
});

// ---------------------------------------------------------------------------
// healthCheck
// ---------------------------------------------------------------------------

describe('healthCheck', () => {
  it('always returns true (no external dependency)', async () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    expect(await adapter.healthCheck()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getModel
// ---------------------------------------------------------------------------

describe('getModel', () => {
  it('returns the configured model', () => {
    const adapter = new LocalComputeAdapter({ model: 'my-model', simulatedLatencyMs: 0 });
    expect(adapter.getModel()).toBe('my-model');
  });

  it('returns "local" when no model is configured', () => {
    const adapter = new LocalComputeAdapter({ simulatedLatencyMs: 0 });
    expect(adapter.getModel()).toBe('local');
  });
});
