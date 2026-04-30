import type { Finding } from './researchTypes.js';

/**
 * Asks the LLM to break a topic into 3-5 sub-questions.
 *
 * Output is expected to be a single JSON object: {"questions": ["...", ...]}.
 * The agent retries once with a stricter reminder if the first attempt
 * does not parse, then falls back to using the topic itself as a single
 * question.
 */
export function planPrompt(topic: string): string {
  return `You are a research planner. Break this topic into 3-5 short, focused sub-questions whose answers together would give a comprehensive overview.

Topic: ${topic}

Output ONLY a single JSON object in this exact shape, with no commentary, no markdown fence:
{"questions": ["question 1", "question 2", "question 3"]}`;
}

/**
 * Asks the LLM to summarize a source excerpt against a sub-question.
 *
 * The output is plain prose (no JSON) — 2-3 sentences — that becomes
 * the `summary` field of a Finding. If the excerpt does not address
 * the question, the model is instructed to say so explicitly rather
 * than fabricate.
 */
export function extractPrompt(question: string, evidence: string): string {
  // Bound evidence to keep the prompt well under token limits.
  const trimmed = evidence.slice(0, 4000);
  return `You are a research extractor. From the source excerpt below, summarize the key facts that answer the sub-question. Be concise — 2-3 sentences max. If the excerpt does not address the question, say "(no relevant data)".

Sub-question: ${question}

Source excerpt:
"""
${trimmed}
"""

Output: a single short paragraph. No JSON, no preamble, no quoting.`;
}

/**
 * Asks the LLM to synthesize findings into a coherent report.
 *
 * Output is markdown prose that cites findings by their index — [1], [2], etc.
 */
export function synthesizePrompt(topic: string, findings: Finding[]): string {
  const numbered = findings
    .map((f) => `[${f.index}] (Q: ${f.question})\n${f.summary}`)
    .join('\n\n');

  return `You are a research synthesizer. Below are findings collected for the topic "${topic}". Write a concise report (3-5 paragraphs) that synthesizes them. Cite findings as [1], [2], etc., matching their index. Stay grounded in what the findings actually say — do not invent.

Findings:
${numbered}

Output: the report as plain markdown. No JSON, no preamble.`;
}
