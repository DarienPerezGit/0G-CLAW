/**
 * basic-agent — 0G-Claw example agent
 *
 * Demonstrates:
 *   - Adapter selection via MEMORY_ADAPTER=local|0g and COMPUTE_ADAPTER=local|0g
 *   - Session persistence: load prior session on startup, append after each turn
 *   - Multi-turn chat loop (at least 3 exchanges)
 *   - Verifiable inference: prints verificationHash when backed by 0G Compute
 *
 * Run:
 *   pnpm example:basic                          # local memory + local compute
 *   MEMORY_ADAPTER=0g pnpm example:basic        # 0G Storage memory + local compute
 *   MEMORY_ADAPTER=0g COMPUTE_ADAPTER=0g pnpm example:basic  # fully decentralized
 *
 * Environment variables:
 *   MEMORY_ADAPTER      local (default) | 0g
 *   COMPUTE_ADAPTER     local (default) | 0g
 *   OG_STORAGE_RPC      EVM RPC for 0G chain
 *   OG_STORAGE_INDEXER  0G Storage indexer endpoint
 *   OG_PRIVATE_KEY      Wallet private key
 *   OG_COMPUTE_PROVIDER Provider address for 0G Compute (must be funded)
 *   AGENT_ID            Agent identity string (default: "claw-agent-0")
 *   SESSION_ID          Session to resume (default: auto-generated)
 */

import { config as loadDotenv } from 'dotenv';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';

loadDotenv({ override: true });

import type { IMemoryAdapter, AgentSession, SessionMessage } from '../../adapters/memory/IMemoryAdapter.js';
import type { IComputeAdapter, ChatMessage } from '../../adapters/compute/IComputeAdapter.js';

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------

const MEMORY_ADAPTER  = (process.env['MEMORY_ADAPTER']  ?? 'local').toLowerCase();
const COMPUTE_ADAPTER = (process.env['COMPUTE_ADAPTER'] ?? 'local').toLowerCase();

const AGENT_ID   = process.env['AGENT_ID']   ?? 'claw-agent-0';
const SESSION_ID = process.env['SESSION_ID'] ?? `session-${crypto.randomBytes(4).toString('hex')}`;

async function buildMemoryAdapter(): Promise<IMemoryAdapter> {
  if (MEMORY_ADAPTER === '0g') {
    const rpc      = process.env['OG_STORAGE_RPC'];
    const indexer  = process.env['OG_STORAGE_INDEXER'];
    const key      = process.env['OG_PRIVATE_KEY'];

    if (!rpc || !indexer || !key) {
      console.error(
        '[agent] MEMORY_ADAPTER=0g but OG_STORAGE_RPC / OG_STORAGE_INDEXER / OG_PRIVATE_KEY are missing.\n' +
        '        Falling back to LocalMemoryAdapter.',
      );
      const { LocalMemoryAdapter } = await import('../../adapters/memory/LocalMemoryAdapter.js');
      return new LocalMemoryAdapter();
    }

    const { OGMemoryAdapter } = await import('../../adapters/memory/0GMemoryAdapter.js');
    return new OGMemoryAdapter({ rpc, indexer, privateKey: key });
  }

  const { LocalMemoryAdapter } = await import('../../adapters/memory/LocalMemoryAdapter.js');
  return new LocalMemoryAdapter();
}

async function buildComputeAdapter(): Promise<IComputeAdapter> {
  if (COMPUTE_ADAPTER === '0g') {
    const rpc      = process.env['OG_STORAGE_RPC'];
    const key      = process.env['OG_PRIVATE_KEY'];
    const provider = process.env['OG_COMPUTE_PROVIDER'];

    if (!rpc || !key || !provider) {
      console.error(
        '[agent] COMPUTE_ADAPTER=0g but OG_STORAGE_RPC / OG_PRIVATE_KEY / OG_COMPUTE_PROVIDER are missing.\n' +
        '        Falling back to LocalComputeAdapter.',
      );
      const { LocalComputeAdapter } = await import('../../adapters/compute/LocalComputeAdapter.js');
      return new LocalComputeAdapter();
    }

    const { OGComputeAdapter } = await import('../../adapters/compute/0GComputeAdapter.js');
    return new OGComputeAdapter({ rpc, privateKey: key, providerAddress: provider });
  }

  const { LocalComputeAdapter } = await import('../../adapters/compute/LocalComputeAdapter.js');
  return new LocalComputeAdapter();
}

// ---------------------------------------------------------------------------
// Agent boot
// ---------------------------------------------------------------------------

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  0G-Claw Basic Agent');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Agent ID   : ${AGENT_ID}`);
console.log(`  Session ID : ${SESSION_ID}`);
console.log(`  Memory     : ${MEMORY_ADAPTER}`);
console.log(`  Compute    : ${COMPUTE_ADAPTER}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const memory  = await buildMemoryAdapter();
const compute = await buildComputeAdapter();

const model = compute.getModel();
console.log(`[agent] compute model: ${model}`);

// ---------------------------------------------------------------------------
// Session: load or create
// ---------------------------------------------------------------------------

let session: AgentSession | null = await memory.loadSession(AGENT_ID, SESSION_ID);
let isResumed = false;

if (session !== null) {
  isResumed = true;
  console.log(`[agent] resumed session with ${session.messages.length} message(s) in state`);
} else {
  session = {
    sessionId: SESSION_ID,
    agentId:   AGENT_ID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages:  [],
    metadata:  { memoryAdapter: MEMORY_ADAPTER, computeAdapter: COMPUTE_ADAPTER },
  };
  console.log('[agent] started new session');
}

// Load immutable history (append-only log) and print last few turns
const history = await memory.loadHistory(AGENT_ID, SESSION_ID);
if (history.length > 0) {
  console.log(`[agent] ${history.length} message(s) in history log`);
  const tail = history.slice(-4);
  for (const msg of tail) {
    const when = new Date(msg.timestamp).toISOString();
    const prefix = msg.role === 'user' ? 'You' : 'Agent';
    console.log(`  [${when}] ${prefix}: ${msg.content.slice(0, 80)}${msg.content.length > 80 ? '…' : ''}`);
  }
}

if (isResumed) {
  console.log('\n[agent] Memory loaded from ' + (MEMORY_ADAPTER === '0g' ? '0G Storage (decentralized)' : 'local filesystem') + '.');
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const systemPrompt: ChatMessage = {
  role: 'system',
  content:
    'You are a helpful AI assistant running inside 0G-Claw, a decentralized agent runtime. ' +
    'Be concise. Remember context from earlier in this conversation.',
};

// ---------------------------------------------------------------------------
// Conversation loop
// ---------------------------------------------------------------------------

// Seed the in-memory message window from saved session state
// (max last 20 messages to keep context window bounded)
const contextWindow: ChatMessage[] = [
  systemPrompt,
  ...session.messages.slice(-20).map((m): ChatMessage => ({
    role:    m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  })),
];

const EXCHANGE_PROMPTS = [
  'What can you help me with?',
  'Can you tell me something interesting about decentralized AI?',
  'Summarize what we just talked about in one sentence.',
];

const rl = readline.createInterface({ input, output });
let exchangeCount = 0;
const isInteractive = process.stdin.isTTY;

/**
 * Persist a message to both the mutable session state and the append-only log.
 */
async function persistMessage(msg: SessionMessage): Promise<void> {
  // Append to immutable log
  await memory.appendMessage(AGENT_ID, SESSION_ID, msg);

  // Update mutable session snapshot
  session!.messages.push(msg);
  session!.updatedAt = Date.now();
  await memory.saveSession(session!);
}

async function runExchange(userInput: string): Promise<void> {
  const userMsg: SessionMessage = {
    role:      'user',
    content:   userInput.trim(),
    timestamp: Date.now(),
  };

  contextWindow.push({ role: 'user', content: userMsg.content });

  console.log(`\n[user] ${userMsg.content}`);

  await persistMessage(userMsg);

  // Run inference
  let result;
  try {
    result = await compute.chat(contextWindow, { maxTokens: 512 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] compute error: ${message}`);

    // If 0G Compute is unfunded, the error is explicit — tell the user
    if (message.includes('broker not funded or not initialized')) {
      console.error(
        '[agent] Compute broker is not funded yet.\n' +
        '        Set COMPUTE_ADAPTER=local to use LocalComputeAdapter instead,\n' +
        '        or fund the broker following .env.example instructions.',
      );
    }
    return;
  }

  const assistantMsg: SessionMessage = {
    role:      'assistant',
    content:   result.content,
    timestamp: Date.now(),
  };

  contextWindow.push({ role: 'assistant', content: result.content });

  await persistMessage(assistantMsg);

  console.log(`\n[agent] ${result.content}`);
  console.log(`        model: ${result.model} | tokens: ${result.usage.totalTokens}`);

  if (result.verificationHash !== undefined) {
    console.log(`        verificationHash: ${result.verificationHash} (0G TeeML proof)`);
  }

  exchangeCount++;
}

if (isInteractive) {
  // Interactive mode — prompt user for input
  console.log('\nType your messages below. Press Ctrl+C or type "exit" to quit.\n');

  while (true) {
    let userInput: string;
    try {
      userInput = await rl.question('[you] ');
    } catch {
      // Ctrl+C or stdin closed
      break;
    }

    if (!userInput.trim() || userInput.trim().toLowerCase() === 'exit') {
      break;
    }

    await runExchange(userInput);
  }
} else {
  // Non-interactive mode — run scripted exchanges (useful in Docker / CI)
  console.log('[agent] non-interactive mode — running scripted exchanges\n');

  for (const prompt of EXCHANGE_PROMPTS) {
    await runExchange(prompt);
  }
}

rl.close();

// ---------------------------------------------------------------------------
// End-of-session summary
// ---------------------------------------------------------------------------

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Session complete — ${exchangeCount} exchange(s) this run`);
console.log(`  Total messages persisted: ${session.messages.length}`);
console.log(`  Memory backend: ${MEMORY_ADAPTER === '0g' ? '0G Storage (decentralized)' : 'local filesystem'}`);
console.log('');
console.log('  To resume this session from any machine:');
console.log(`    SESSION_ID=${SESSION_ID} MEMORY_ADAPTER=${MEMORY_ADAPTER} pnpm example:basic`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

