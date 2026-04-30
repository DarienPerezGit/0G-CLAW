import { describe, it, expect } from 'vitest';
import { topicIdFromString } from './topicId.js';

describe('topicIdFromString', () => {
  it('returns 8 hex characters', () => {
    const id = topicIdFromString('0G Protocol architecture');
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic — same topic always produces same id', () => {
    const a = topicIdFromString('verifiable inference');
    const b = topicIdFromString('verifiable inference');
    expect(a).toBe(b);
  });

  it('normalizes case and surrounding whitespace', () => {
    const a = topicIdFromString('Decentralized AI');
    const b = topicIdFromString('  decentralized ai  ');
    expect(a).toBe(b);
  });

  it('produces different ids for different topics', () => {
    const a = topicIdFromString('0G Protocol');
    const b = topicIdFromString('Filecoin');
    expect(a).not.toBe(b);
  });

  it('rejects empty / whitespace-only topics', () => {
    expect(() => topicIdFromString('')).toThrow(/must not be empty/);
    expect(() => topicIdFromString('   ')).toThrow(/must not be empty/);
  });
});
