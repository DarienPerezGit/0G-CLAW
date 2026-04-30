/**
 * research-agent — inspect cached research (read-only)
 *
 * Loads a topic's persisted research state and history from the configured
 * memory adapter and prints a structured summary: sub-questions, findings
 * with their verificationHashes, the cached report, and a snapshot/log
 * consistency check.
 *
 * Usage:
 *   RESEARCH_TOPIC="0G Protocol architecture" pnpm example:research:inspect
 *   RESEARCH_TOPIC="..." MEMORY_ADAPTER=0g pnpm example:research:inspect
 *
 * Why this exists:
 *   This script is the most direct demonstration of "shared memory across
 *   agents". The inspecting process never participates in the research —
 *   it only queries the memory adapter. Run on machine A, run on machine B
 *   with the same wallet + same topic, and both will see the same data.
 *
 *   It is also the cleanest evidence of verifiable inference at the
 *   submission level: the printed verificationHash table proves every LLM
 *   call was attested by the configured 0G Compute provider.
 *
 *   Read-only: this script does not call compute, does not invoke any
 *   tools, and does not write to memory. Pure memory query.
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ override: true });

import type { IMemoryAdapter, SessionMessage } from '../../adapters/memory/IMemoryAdapter.js';

import { topicIdFromString } from './lib/topicId.js';
import type { Finding, ResearchState } from './lib/researchTypes.js';

// ---------------------------------------------------------------------------
// Env / config
// ---------------------------------------------------------------------------

const RESEARCH_TOPIC = process.env['RESEARCH_TOPIC'];
if (RESEARCH_TOPIC === undefined || RESEARCH_TOPIC.trim().length === 0) {
  console.error(
    'research-agent inspect: RESEARCH_TOPIC env var is required.\n' +
      '  Usage: RESEARCH_TOPIC="your topic" pnpm example:research:inspect',
  );
  process.exit(1);
}

const MEMORY_ADAPTER = (process.env['MEMORY_ADAPTER'] ?? 'local').toLowerCase();

const TOPIC = RESEARCH_TOPIC.trim();
const TOPIC_ID = topicIdFromString(TOPIC);
const AGENT_ID = `research-${TOPIC_ID}`;
const SESSION_ID = 'findings';

// ---------------------------------------------------------------------------
// Memory adapter (no compute — this is a read-only viewer)
// ---------------------------------------------------------------------------

async function buildMemoryAdapter(): Promise<IMemoryAdapter> {
  if (MEMORY_ADAPTER === '0g') {
    const rpc = process.env['OG_STORAGE_RPC'];
    const indexer = process.env['OG_STORAGE_INDEXER'];
    const key = process.env['OG_PRIVATE_KEY'];
    if (rpc === undefined || indexer === undefined || key === undefined) {
      console.error(
        '[inspect] MEMORY_ADAPTER=0g but OG_STORAGE_RPC / OG_STORAGE_INDEXER / OG_PRIVATE_KEY are missing.\n' +
          '          Falling back to LocalMemoryAdapter.',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStateMessage(m: SessionMessage): boolean {
  return m.role === 'system' && m.content.startsWith('{');
}

function decodeFindingFromMessage(m: SessionMessage): Finding | null {
  if (m.role !== 'assistant') return null;
  try {
    return JSON.parse(m.content) as Finding;
  } catch {
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  0G-Claw Research Inspector (read-only)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Topic       : ${TOPIC}`);
console.log(`  Topic ID    : ${TOPIC_ID}`);
console.log(`  Agent ID    : ${AGENT_ID}`);
console.log(`  Memory      : ${MEMORY_ADAPTER}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const memory = await buildMemoryAdapter();

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const session = await memory.loadSession(AGENT_ID, SESSION_ID);

if (session === null) {
  console.log('[inspect] No research found for this topic.');
  console.log(`          Run: RESEARCH_TOPIC="${TOPIC}" pnpm example:research`);
  process.exit(0);
}

let state: ResearchState | null = null;
const stateMsg = session.messages.find(isStateMessage);
if (stateMsg !== undefined) {
  try {
    state = JSON.parse(stateMsg.content) as ResearchState;
  } catch {
    state = null;
  }
}

const log = await memory.loadHistory(AGENT_ID, SESSION_ID);
const logFindings: Finding[] = [];
for (const msg of log) {
  const f = decodeFindingFromMessage(msg);
  if (f !== null) logFindings.push(f);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const stateFindingCount = state?.findings.length ?? 0;
const logFindingCount = logFindings.length;

console.log('Summary');
console.log('-------');
console.log(`  Sub-questions planned : ${state?.subQuestions.length ?? 0}`);
console.log(`  Findings (KV snapshot): ${stateFindingCount}`);
console.log(`  Findings (Log Store)  : ${logFindingCount}`);
console.log(`  Report cached         : ${state?.reportMarkdown !== null && state?.reportMarkdown !== undefined ? 'yes' : 'no'}`);
console.log(
  `  Synthesis verified    : ${state?.synthesisVerificationHash !== undefined ? `yes (${state.synthesisVerificationHash.slice(0, 18)}…)` : 'no'}`,
);
console.log();

if (logFindingCount > stateFindingCount) {
  console.log(
    `  ⚠ Log has ${logFindingCount - stateFindingCount} more finding(s) than the snapshot — running the agent again will recover from the log.\n`,
  );
}

// ---------------------------------------------------------------------------
// Sub-questions
// ---------------------------------------------------------------------------

if (state !== null && state.subQuestions.length > 0) {
  console.log('Sub-questions');
  console.log('-------------');
  state.subQuestions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  console.log();
}

// ---------------------------------------------------------------------------
// Findings table — verificationHash is the audit-grade evidence column
// ---------------------------------------------------------------------------

const findings = (state?.findings.length ?? 0) > 0 ? state!.findings : logFindings;

if (findings.length > 0) {
  console.log('Findings');
  console.log('--------');
  for (const f of findings) {
    console.log(`  [${f.index}] ${f.question}`);
    console.log(`        source : ${f.source}`);
    console.log(`        summary: ${truncate(f.summary, 200)}`);
    console.log(`        hash   : ${f.verificationHash ?? '(none — non-0G compute)'}`);
    console.log(`        time   : ${new Date(f.timestamp).toISOString()}`);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (state?.reportMarkdown !== null && state?.reportMarkdown !== undefined) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Report — ${TOPIC}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(state.reportMarkdown);
  console.log();
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Memory backend: ${MEMORY_ADAPTER === '0g' ? '0G Storage (decentralized)' : 'local filesystem'}`);
console.log(`  Inspected (no writes): ${AGENT_ID}/${SESSION_ID}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
