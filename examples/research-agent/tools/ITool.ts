/**
 * Result returned by an ITool execution.
 *
 * `source` is a citation-friendly identifier (e.g. "wikipedia:Decentralized_AI",
 * "memory-recall", "url:https://...").
 *
 * `content` is the raw evidence — typically a passage of prose. It is consumed
 * downstream by the LLM extractor, which produces the human-readable summary.
 */
export interface ToolResult {
  source: string;
  content: string;
}

/**
 * Tool abstraction local to the research-agent example.
 *
 * Tools are intentionally NOT a framework primitive in this PR. The framework
 * surface is still memory + compute. If we later promote ITool to live under
 * adapters/tools/, the migration is straightforward: this file becomes the
 * canonical interface and the adapter package re-exports it.
 *
 * Implementations MUST NOT throw on transport / network failures — they
 * should return a ToolResult whose content explains the failure (e.g.
 * "(no results)", "(network error: ENETDOWN)"). This keeps the research
 * pipeline robust to single-tool failures.
 */
export interface ITool {
  /** Short, stable identifier — used for logging and routing. */
  readonly name: string;

  /** Human-readable description — used for tool-discovery prompts (future). */
  readonly description: string;

  /**
   * Executes the tool with the given input. Must always resolve.
   * Errors are encoded inside `ToolResult.content` rather than thrown.
   */
  run(input: string): Promise<ToolResult>;
}
