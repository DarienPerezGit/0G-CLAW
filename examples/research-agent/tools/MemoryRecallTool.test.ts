import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalMemoryAdapter } from '../../../adapters/memory/LocalMemoryAdapter.js';
import { MemoryRecallTool } from './MemoryRecallTool.js';
import type { Finding } from '../lib/researchTypes.js';

const AGENT_ID = 'research-test';
const SESSION_ID = 'findings';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    index: 1,
    question: 'What is 0G?',
    source: 'wikipedia:0G_Protocol',
    evidence: 'Some Wikipedia text about 0G.',
    summary: '0G is a decentralized infrastructure protocol with KV/Log storage.',
    verificationHash: undefined,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('MemoryRecallTool', () => {
  let tmpDir: string;
  let memory: LocalMemoryAdapter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mrt-'));
    memory = new LocalMemoryAdapter({ storageDir: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns matches when the query is present in summary', async () => {
    const finding = makeFinding();
    await memory.appendMessage(AGENT_ID, SESSION_ID, {
      role: 'assistant',
      content: JSON.stringify(finding),
      timestamp: finding.timestamp,
    });

    const tool = new MemoryRecallTool({ memory, agentId: AGENT_ID, sessionId: SESSION_ID });
    const result = await tool.run('decentralized');

    expect(result.source).toBe('memory-recall');
    expect(result.content).toContain('0G is a decentralized');
    expect(result.content).toContain('[1]');
  });

  it('matches against question and evidence too, not just summary', async () => {
    const finding = makeFinding({
      summary: 'unrelated summary',
      question: 'How does the broker work?',
      evidence: 'Some text about brokers.',
    });
    await memory.appendMessage(AGENT_ID, SESSION_ID, {
      role: 'assistant',
      content: JSON.stringify(finding),
      timestamp: finding.timestamp,
    });

    const tool = new MemoryRecallTool({ memory, agentId: AGENT_ID, sessionId: SESSION_ID });
    const result = await tool.run('broker');

    expect(result.content).toContain('How does the broker work?');
  });

  it('returns no-match when nothing relevant is present', async () => {
    await memory.appendMessage(AGENT_ID, SESSION_ID, {
      role: 'assistant',
      content: JSON.stringify(makeFinding()),
      timestamp: Date.now(),
    });

    const tool = new MemoryRecallTool({ memory, agentId: AGENT_ID, sessionId: SESSION_ID });
    const result = await tool.run('quantum widgets');

    expect(result.content).toBe('(no prior findings match)');
  });

  it('skips non-JSON assistant messages without erroring', async () => {
    await memory.appendMessage(AGENT_ID, SESSION_ID, {
      role: 'assistant',
      content: 'this is just a plain assistant message',
      timestamp: Date.now(),
    });
    await memory.appendMessage(AGENT_ID, SESSION_ID, {
      role: 'assistant',
      content: JSON.stringify(makeFinding()),
      timestamp: Date.now(),
    });

    const tool = new MemoryRecallTool({ memory, agentId: AGENT_ID, sessionId: SESSION_ID });
    const result = await tool.run('decentralized');

    expect(result.content).toContain('0G is a decentralized');
  });

  it('ignores user / system messages even if their content matches', async () => {
    await memory.appendMessage(AGENT_ID, SESSION_ID, {
      role: 'user',
      content: 'I want to learn about decentralized AI',
      timestamp: Date.now(),
    });

    const tool = new MemoryRecallTool({ memory, agentId: AGENT_ID, sessionId: SESSION_ID });
    const result = await tool.run('decentralized');

    expect(result.content).toBe('(no prior findings match)');
  });

  it('returns empty-query message on blank input without reading history', async () => {
    const tool = new MemoryRecallTool({ memory, agentId: AGENT_ID, sessionId: SESSION_ID });
    const result = await tool.run('   ');

    expect(result.content).toBe('(empty query)');
  });
});
