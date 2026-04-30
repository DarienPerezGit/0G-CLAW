import { createHash } from 'node:crypto';

/**
 * Derives a stable 8-character hex ID from a topic string.
 *
 * Used as part of the agent ID so that the same topic, on any machine,
 * with the same wallet, maps to the same memory namespace. This is what
 * makes 0G-Claw's "shared memory across agents" capability surface in
 * the research-agent: same topic = same research, deterministically.
 */
export function topicIdFromString(topic: string): string {
  const normalized = topic.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error('topicIdFromString: topic must not be empty');
  }
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8);
}
