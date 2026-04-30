/**
 * One unit of evidence collected during research.
 *
 * Findings are persisted in two places by the agent:
 *   - mutable session state (KV) — for fast resume via loadSession
 *   - append-only log (Log Store) — for replayable execution
 *
 * `verificationHash` is set only when the underlying compute adapter
 * is 0GComputeAdapter and the response carried a TeeML proof.
 */
export interface Finding {
  index: number;
  question: string;
  source: string;
  evidence: string;
  summary: string;
  verificationHash: string | undefined;
  timestamp: number;
}

/**
 * Research session state, snapshot serializable to JSON.
 *
 * Stored as a single role:"system" message inside AgentSession.messages
 * so the existing IMemoryAdapter contract carries the domain payload
 * unchanged.
 */
export interface ResearchState {
  topic: string;
  topicId: string;
  subQuestions: string[];
  findings: Finding[];
  reportMarkdown: string | null;
}
