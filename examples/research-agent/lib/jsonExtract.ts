/**
 * Best-effort JSON parser tolerant of common LLM output quirks.
 *
 * Accepts:
 *   - bare JSON:                    `{"foo": 1}`
 *   - markdown code-fenced JSON:    ` ```json\n{"foo": 1}\n``` `
 *   - plain code-fenced JSON:       ` ```\n{"foo": 1}\n``` `
 *   - JSON embedded in prose:       `Here is your answer: {"foo": 1} hope this helps`
 *
 * Returns null on any parse failure rather than throwing — callers decide
 * how to recover (retry, fallback, abort). Used by research-agent to handle
 * LLM responses to its planning prompt, where the model occasionally adds
 * commentary despite "JSON only" instructions.
 */
export function tryParseJSON<T>(text: string): T | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fallback: extract the first {...} block from surrounding prose
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match !== null) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
