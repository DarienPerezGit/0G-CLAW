import type {
  IComputeAdapter,
  ChatMessage,
  InferenceOptions,
  InferenceResult,
} from './IComputeAdapter.js';

export interface LocalComputeAdapterConfig {
  /**
   * Model identifier reported in InferenceResult.
   * Defaults to "local".
   */
  model?: string;

  /**
   * Simulated latency in milliseconds before resolving.
   * Mimics the async nature of real compute backends so that
   * timing-dependent bugs surface in local testing too.
   * Defaults to 100ms.
   */
  simulatedLatencyMs?: number;
}

/**
 * Deterministic local fallback implementation of IComputeAdapter.
 *
 * Does NOT call any external API. Responds by echoing the last user message
 * with a "[local]" prefix. This is intentionally simple — the value of this
 * adapter is structural correctness and swap-safety, not intelligence.
 *
 * verificationHash is always undefined. Non-0G adapters MUST NOT simulate
 * or fabricate this field.
 *
 * Latency is simulated via a configurable delay so that code consuming this
 * adapter behaves consistently with real compute backends.
 */
export class LocalComputeAdapter implements IComputeAdapter {
  private readonly _model: string;
  private readonly simulatedLatencyMs: number;

  constructor(config: LocalComputeAdapterConfig = {}) {
    this._model = config.model ?? 'local';
    this.simulatedLatencyMs = config.simulatedLatencyMs ?? 100;
  }

  async chat(messages: ChatMessage[], options?: InferenceOptions): Promise<InferenceResult> {
    if (messages.length === 0) {
      throw new Error('LocalComputeAdapter: messages array must not be empty');
    }

    for (const msg of messages) {
      if (typeof msg.content !== 'string' || msg.content.length === 0) {
        throw new Error(
          `LocalComputeAdapter: message content must be a non-empty string, got: ${JSON.stringify(msg.content)}`,
        );
      }
    }

    const model = options?.model ?? this._model;

    // Simulate network/compute latency so timing-dependent bugs surface locally.
    await delay(this.simulatedLatencyMs);

    // Deterministic response: echo the last user message.
    // This makes tests predictable without any external dependency.
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const responseContent = lastUserMessage
      ? `[local] ${lastUserMessage.content}`
      : '[local] (no user message found)';

    // Token count estimation: 1 token ≈ 4 characters (rough but consistent).
    const promptTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    const completionTokens = Math.ceil(responseContent.length / 4);

    const result: InferenceResult = {
      content: responseContent,
      model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      // Explicit undefined — non-0G adapters MUST NOT fabricate this value.
      verificationHash: undefined,
    };

    return result;
  }

  async healthCheck(): Promise<boolean> {
    // Local adapter is always healthy — no external dependency to check.
    return true;
  }

  getModel(): string {
    return this._model;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
