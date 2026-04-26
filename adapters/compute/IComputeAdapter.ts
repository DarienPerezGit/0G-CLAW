export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface InferenceOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface InferenceResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /**
   * Cryptographic verification hash from 0G Compute.
   * Defined only when the response is backed by a 0G verifiable inference proof.
   * Non-0G adapters MUST return undefined — do NOT simulate or fabricate this value.
   */
  verificationHash: string | undefined;
}

/**
 * Contract for all compute backends (0G Compute, OpenAI, local models, etc.).
 *
 * chat() is the primary inference method. It must always return a fully resolved
 * InferenceResult or reject with a descriptive Error.
 *
 * healthCheck() must not throw — return false if the backend is unreachable.
 *
 * Adapters must NOT assume environment variables are available at import time.
 * Configuration must be injected explicitly via constructor.
 */
export interface IComputeAdapter {
  /**
   * Runs inference over the provided message history.
   * Options override adapter-level defaults (model, temperature, maxTokens).
   * Rejects if the backend is unavailable or returns a non-recoverable error.
   */
  chat(messages: ChatMessage[], options?: InferenceOptions): Promise<InferenceResult>;

  /**
   * Checks whether the compute backend is reachable and the configured model is available.
   * Returns false on any failure — does NOT reject.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Returns the model identifier currently configured on this adapter instance.
   */
  getModel(): string;
}
