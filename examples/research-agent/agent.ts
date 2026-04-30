/**
 * research-agent — 0G-Claw second example agent
 *
 * Demonstrates that the 0G-Claw framework supports more than chat-style
 * agents: this is a topic-driven, tool-using research pipeline that
 * persists every finding to 0G memory and synthesizes a structured report.
 *
 * Pipeline:
 *   plan  →  research(loop with WikipediaSearchTool + LLM extraction)  →  synthesize
 *
 * 0G-native capabilities surfaced:
 *   - Verifiable inference  : verificationHash captured on every LLM call
 *   - Shared memory         : agentId derives from sha256(topic), so the same
 *                             topic + same wallet on any machine = same research
 *   - Replayable execution  : every finding goes to the Log Store; the report
 *                             can be reconstructed from the log alone
 *   - Portable identity     : same wallet, any machine, same research namespace
 *
 * Usage:
 *   RESEARCH_TOPIC="0G Protocol architecture" pnpm example:research
 *   RESEARCH_TOPIC="..." MEMORY_ADAPTER=0g COMPUTE_ADAPTER=0g pnpm example:research
 *
 * Re-running with the same topic + same wallet skips the research phase and
 * reprints the cached report. Persisted under agentId=research-{topicId},
 * sessionId="findings".
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ override: true });

import type {
  IMemoryAdapter,
  AgentSession,
  SessionMessage,
} from '../../adapters/memory/IMemoryAdapter.js';
import type {
  IComputeAdapter,
  ChatMessage,
} from '../../adapters/compute/IComputeAdapter.js';

import { topicIdFromString } from './lib/topicId.js';
import { planPrompt, extractPrompt, synthesizePrompt } from './lib/prompts.js';
import { tryParseJSON } from './lib/jsonExtract.js';
import type { Finding, ResearchState } from './lib/researchTypes.js';
import { WikipediaSearchTool } from './tools/WikipediaSearchTool.js';

// ---------------------------------------------------------------------------
// Env / config
// ---------------------------------------------------------------------------

const RESEARCH_TOPIC = process.env['RESEARCH_TOPIC'];
if (RESEARCH_TOPIC === undefined || RESEARCH_TOPIC.trim().length === 0) {
  console.error(
    'research-agent: RESEARCH_TOPIC env var is required.\n' +
      '  Usage: RESEARCH_TOPIC="your topic" pnpm example:research',
  );
  process.exit(1);
}

const MEMORY_ADAPTER = (process.env['MEMORY_ADAPTER'] ?? 'local').toLowerCase();
const COMPUTE_ADAPTER = (process.env['COMPUTE_ADAPTER'] ?? 'local').toLowerCase();

const TOPIC = RESEARCH_TOPIC.trim();
const TOPIC_ID = topicIdFromString(TOPIC);
const AGENT_ID = `research-${TOPIC_ID}`;
const SESSION_ID = 'findings';

// ---------------------------------------------------------------------------
// Adapter selection (mirrors basic-agent — env-var dispatch with fallback)
// ---------------------------------------------------------------------------

async function buildMemoryAdapter(): Promise<IMemoryAdapter> {
  if (MEMORY_ADAPTER === '0g') {
    const rpc = process.env['OG_STORAGE_RPC'];
    const indexer = process.env['OG_STORAGE_INDEXER'];
    const key = process.env['OG_PRIVATE_KEY'];
    if (rpc === undefined || indexer === undefined || key === undefined) {
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
    const rpc = process.env['OG_STORAGE_RPC'];
    const key = process.env['OG_PRIVATE_KEY'];
    const provider = process.env['OG_COMPUTE_PROVIDER'];
    if (rpc === undefined || key === undefined || provider === undefined) {
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
// Boot banner
// ---------------------------------------------------------------------------

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  0G-Claw Research Agent');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Topic       : ${TOPIC}`);
console.log(`  Topic ID    : ${TOPIC_ID}`);
console.log(`  Agent ID    : ${AGENT_ID}`);
console.log(`  Memory      : ${MEMORY_ADAPTER}`);
console.log(`  Compute     : ${COMPUTE_ADAPTER}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (COMPUTE_ADAPTER === 'local') {
  console.warn(
    '[agent] COMPUTE_ADAPTER=local is the echo stub — research output will be nonsense.\n' +
      '        For real research, run with COMPUTE_ADAPTER=0g (requires funded broker).\n',
  );
}

const memory = await buildMemoryAdapter();
const compute = await buildComputeAdapter();

console.log(`[agent] compute model: ${compute.getModel()}\n`);

// ---------------------------------------------------------------------------
// Session: load prior research state if any
// ---------------------------------------------------------------------------

function newResearchState(): ResearchState {
  return {
    topic: TOPIC,
    topicId: TOPIC_ID,
    subQuestions: [],
    findings: [],
    reportMarkdown: null,
    synthesisVerificationHash: undefined,
  };
}

function isStateMessage(m: SessionMessage): boolean {
  return m.role === 'system' && m.content.startsWith('{');
}

let session: AgentSession;
const loaded = await memory.loadSession(AGENT_ID, SESSION_ID);

let state: ResearchState;
if (loaded !== null) {
  session = loaded;
  const stateMsg = session.messages.find(isStateMessage);
  if (stateMsg !== undefined) {
    try {
      const parsed = JSON.parse(stateMsg.content) as Partial<ResearchState>;
      // Hydrate with defaults for any fields the snapshot is missing
      // (e.g. older snapshots predating synthesisVerificationHash).
      state = { ...newResearchState(), ...parsed };
    } catch {
      console.warn('[agent] prior session state could not be parsed — starting fresh');
      state = newResearchState();
    }
  } else {
    state = newResearchState();
  }
} else {
  state = newResearchState();
  session = {
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    metadata: { topic: TOPIC, topicId: TOPIC_ID, kind: 'research' },
  };
}

// ---------------------------------------------------------------------------
// Durability: cross-check the KV snapshot against the append-only Log.
//
// Because findings are persisted in two steps — Log append, then KV save —
// a crash or storage hiccup between them can leave the Log ahead of the
// snapshot. On boot, if the Log holds more findings than the snapshot
// claims, we recover from the Log (which is the source of truth for
// replayable execution).
// ---------------------------------------------------------------------------

{
  const log = await memory.loadHistory(AGENT_ID, SESSION_ID);
  const logFindings: Finding[] = [];
  for (const msg of log) {
    if (msg.role !== 'assistant') continue;
    try {
      logFindings.push(JSON.parse(msg.content) as Finding);
    } catch {
      // not a JSON-encoded finding (plain assistant message), skip
    }
  }
  if (logFindings.length > state.findings.length) {
    console.warn(
      `[agent] Log Store has ${logFindings.length} finding(s) but state snapshot only ${state.findings.length} — recovering from log.`,
    );
    state.findings = logFindings;
  }
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function persistState(): Promise<void> {
  const stateMsg: SessionMessage = {
    role: 'system',
    content: JSON.stringify(state),
    timestamp: Date.now(),
  };
  // Replace any existing state snapshot rather than letting it grow unbounded
  session.messages = session.messages.filter((m) => !isStateMessage(m));
  session.messages.push(stateMsg);
  session.updatedAt = Date.now();
  await memory.saveSession(session);
}

async function persistFinding(f: Finding): Promise<void> {
  // Append to immutable Log Store (replayable execution)
  await memory.appendMessage(AGENT_ID, SESSION_ID, {
    role: 'assistant',
    content: JSON.stringify(f),
    timestamp: f.timestamp,
  });
  // Update in-memory state and the mutable KV snapshot
  state.findings.push(f);
  await persistState();
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

async function llmCall(
  prompt: string,
  maxTokens = 512,
): Promise<{ content: string; verificationHash: string | undefined }> {
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const result = await compute.chat(messages, { maxTokens });
  return { content: result.content, verificationHash: result.verificationHash };
}

// ---------------------------------------------------------------------------
// Phase 1: plan sub-questions
// ---------------------------------------------------------------------------

async function planSubQuestions(): Promise<string[]> {
  console.log('[plan] Generating sub-questions...');

  const first = await llmCall(planPrompt(TOPIC), 400);
  let parsed = tryParseJSON<{ questions: unknown }>(first.content);

  if (parsed === null || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    console.warn('[plan] First attempt malformed — retrying with stricter prompt...');
    const stricter =
      planPrompt(TOPIC) +
      '\n\nReminder: respond with ONLY the JSON object, no markdown fence, no extra text.';
    const second = await llmCall(stricter, 400);
    parsed = tryParseJSON<{ questions: unknown }>(second.content);
  }

  if (parsed === null || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    console.warn('[plan] Could not parse plan output — falling back to topic itself.');
    return [TOPIC];
  }

  const questions = (parsed.questions as unknown[])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .slice(0, 5);

  if (questions.length === 0) {
    return [TOPIC];
  }

  console.log(`[plan] ${questions.length} sub-question(s):`);
  questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  console.log();

  return questions;
}

// ---------------------------------------------------------------------------
// Phase 2: research loop
// ---------------------------------------------------------------------------

async function researchLoop(questions: string[]): Promise<void> {
  const wikipedia = new WikipediaSearchTool();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q === undefined) continue;
    console.log(`[research] Q${i + 1}/${questions.length}: ${q}`);

    const tooled = await wikipedia.run(q);
    console.log(`  → source: ${tooled.source}`);

    const extracted = await llmCall(extractPrompt(q, tooled.content), 300);
    const summary = extracted.content.trim();

    const finding: Finding = {
      index: i + 1,
      question: q,
      source: tooled.source,
      evidence: tooled.content.slice(0, 2000),
      summary,
      verificationHash: extracted.verificationHash,
      timestamp: Date.now(),
    };

    await persistFinding(finding);

    const preview = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
    console.log(`  → summary: ${preview}`);
    if (finding.verificationHash !== undefined) {
      console.log(`  → verificationHash: ${finding.verificationHash}`);
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Phase 3: synthesize
// ---------------------------------------------------------------------------

async function synthesize(): Promise<{ report: string; verificationHash: string | undefined }> {
  console.log('[synthesis] Producing final report...');
  const result = await llmCall(synthesizePrompt(TOPIC, state.findings), 1024);
  return { report: result.content.trim(), verificationHash: result.verificationHash };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

try {
  if (state.findings.length > 0) {
    console.log(
      `[agent] Found ${state.findings.length} prior finding(s) for this topic — skipping plan + research.\n`,
    );
  } else {
    state.subQuestions = await planSubQuestions();
    await persistState();
    await researchLoop(state.subQuestions);
  }

  if (state.reportMarkdown === null) {
    const synth = await synthesize();
    state.reportMarkdown = synth.report;
    state.synthesisVerificationHash = synth.verificationHash;
    await persistState();
    if (synth.verificationHash !== undefined) {
      console.log(`  → synthesis verificationHash: ${synth.verificationHash}\n`);
    } else {
      console.log();
    }
  } else if (state.synthesisVerificationHash !== undefined) {
    console.log(`[agent] cached synthesis verificationHash: ${state.synthesisVerificationHash}\n`);
  }
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[agent] pipeline error: ${message}`);
  if (message.includes('broker not funded or not initialized')) {
    console.error(
      '[agent] Compute broker is not funded yet.\n' +
        '        Set COMPUTE_ADAPTER=local to use LocalComputeAdapter instead,\n' +
        '        or fund the broker following .env.example instructions.',
    );
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Print final report
// ---------------------------------------------------------------------------

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Report — ${TOPIC}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(state.reportMarkdown ?? '(no report)');
console.log();
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${state.findings.length} finding(s) persisted under ${AGENT_ID}/${SESSION_ID}`);
console.log(
  `  Memory backend: ${MEMORY_ADAPTER === '0g' ? '0G Storage (decentralized)' : 'local filesystem'}`,
);
console.log('');
console.log('  To resume / reprint this report on any machine with the same wallet:');
console.log(`    RESEARCH_TOPIC="${TOPIC}" MEMORY_ADAPTER=${MEMORY_ADAPTER} pnpm example:research`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
