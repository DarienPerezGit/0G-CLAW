import type { ITool, ToolResult } from './ITool.js';
import type { IMemoryAdapter } from '../../../adapters/memory/IMemoryAdapter.js';
import type { Finding } from '../lib/researchTypes.js';

export interface MemoryRecallToolConfig {
  memory: IMemoryAdapter;
  agentId: string;
  sessionId: string;
}

/**
 * Tool: searches prior findings persisted in agent memory.
 *
 * Loads the full append-only history for the active research session
 * and returns findings whose question / summary / evidence contains the
 * query string (case-insensitive substring match).
 *
 * This tool is the building block for incremental research workflows
 * — re-running a topic with extra sub-questions checks memory before
 * hitting external APIs. The MVP agent does not wire this into the main
 * pipeline; it is exported so that downstream agents (or future
 * versions of research-agent) can compose it freely.
 *
 * The match is intentionally simple — substring, no embeddings, no
 * stemming. Embedding-based recall is a deliberate non-goal here:
 * the framework is the deliverable, not a vector store.
 */
export class MemoryRecallTool implements ITool {
  readonly name = 'memory-recall';
  readonly description = 'Search prior findings in agent memory by substring match';

  private readonly memory: IMemoryAdapter;
  private readonly agentId: string;
  private readonly sessionId: string;

  constructor(config: MemoryRecallToolConfig) {
    this.memory = config.memory;
    this.agentId = config.agentId;
    this.sessionId = config.sessionId;
  }

  async run(input: string): Promise<ToolResult> {
    const needle = input.trim().toLowerCase();
    if (needle.length === 0) {
      return { source: 'memory-recall', content: '(empty query)' };
    }

    let history: Awaited<ReturnType<IMemoryAdapter['loadHistory']>>;
    try {
      history = await this.memory.loadHistory(this.agentId, this.sessionId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { source: 'memory-recall', content: `(history read failed: ${msg})` };
    }

    const matches: Finding[] = [];
    for (const msg of history) {
      if (msg.role !== 'assistant') {
        continue;
      }
      let finding: Finding;
      try {
        finding = JSON.parse(msg.content) as Finding;
      } catch {
        // not a JSON-encoded finding (e.g. a plain assistant message), skip
        continue;
      }
      const haystack = `${finding.question} ${finding.summary} ${finding.evidence}`.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push(finding);
      }
    }

    if (matches.length === 0) {
      return { source: 'memory-recall', content: '(no prior findings match)' };
    }

    const formatted = matches
      .map((f) => `[${f.index}] ${f.question}\n${f.summary}`)
      .join('\n\n');

    return { source: 'memory-recall', content: formatted };
  }
}
