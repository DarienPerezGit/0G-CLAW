import type {
  IComputeAdapter,
  ChatMessage,
  InferenceOptions,
  InferenceResult,
} from './IComputeAdapter.js';

// ---------------------------------------------------------------------------
// 0G Compute SDK types (typed after dynamic import in _getBroker)
// ---------------------------------------------------------------------------

interface BrokerInference {
  getServiceMetadata(providerAddress: string): Promise<{ endpoint: string; model: string }>;
  getRequestHeaders(
    providerAddress: string,
    content?: string,
  ): Promise<Record<string, string>>;
  processResponse(
    providerAddress: string,
    chatID?: string,
    content?: string,
  ): Promise<boolean | null>;
}

interface BrokerBundle {
  inference: BrokerInference;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface OGComputeAdapterConfig {
  /**
   * EVM-compatible RPC endpoint for the 0G chain.
   * Example: "https://evmrpc-testnet.0g.ai"
   */
  rpc: string;

  /**
   * Wallet private key — signs billing headers for each inference request.
   * Must be provided via environment variable. Never hardcoded.
   */
  privateKey: string;

  /**
   * Provider address on the 0G Compute Network.
   * Testnet (Galileo):
   *   "0xa48f01287233509FD694a22Bf840225062E67836" → qwen/qwen-2.5-7b-instruct
   *   "0x8e60d466FD16798Bec4868aa4CE38586D5590049" → openai/gpt-oss-20b
   *   "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08" → google/gemma-3-27b-it
   *
   * The adapter auto-discovers the model name and endpoint from the provider at runtime
   * via broker.inference.getServiceMetadata().
   */
  providerAddress: string;

  /**
   * Override the model identifier reported in InferenceResult.
   * If omitted, the model name is read from the provider's service metadata.
   */
  model?: string;

  /**
   * Default temperature for inference requests. Range: [0.0, 2.0].
   * Defaults to 0.7.
   */
  temperature?: number;

  /**
   * Default maximum tokens per completion.
   * Defaults to 2048.
   */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// OGComputeAdapter
// ---------------------------------------------------------------------------

/**
 * 0G Compute-backed IComputeAdapter.
 *
 * ### Flow
 * 1. On first `chat()` call, initializes the 0G Compute broker via dynamic import.
 * 2. Fetches service metadata (endpoint + model) from the configured provider.
 * 3. Generates single-use billing headers signed by the wallet.
 * 4. Sends an OpenAI-compatible chat completion request to the provider endpoint.
 * 5. Calls `processResponse()` to verify the TEE proof and cache the billing fee.
 * 6. Returns an `InferenceResult` with `verificationHash` populated when the
 *    provider is TeeML-verifiable (the `ZG-Res-Key` header is present).
 *
 * ### 0G-native capabilities
 * - **Verifiable inference**: every response includes a TEE proof (TeeML).
 *   `verificationHash` is non-null only on verified responses — never fabricated.
 * - **Micropayment billing**: each request carries a signed payment header;
 *   the provider settles fees on-chain in batches.
 * - **Decentralized routing**: provider discovery and endpoint resolution happen
 *   on-chain via the 0G Inference Serving contract — no centralized API gateway.
 *
 * ### Deferred execution
 * This adapter initializes lazily. If the broker account has insufficient funds
 * or the provider has not been funded, `chat()` throws an explicit error rather
 * than silently falling back. Call `healthCheck()` to detect this state before
 * making inference requests.
 *
 * ### Pre-conditions for live inference (not required to build/test)
 * 1. Wallet has been funded with 0G tokens (≥ 3 OG for ledger creation).
 * 2. Ledger created: `broker.ledger.addLedger(3)` (minimum 3 OG, v0.7.x).
 * 3. Provider acknowledged: `broker.inference.acknowledgeProviderSigner(providerAddress)`.
 * 4. Funds transferred to provider: `broker.ledger.transferFund(providerAddress, "inference", amount)`.
 *
 * Configuration is injected via constructor — no env vars are read here.
 */
export class OGComputeAdapter implements IComputeAdapter {
  private readonly config: OGComputeAdapterConfig;
  private _bundle: BrokerBundle | null = null;
  /** Model name resolved from provider metadata — populated on first chat(). */
  private _resolvedModel: string | null = null;

  constructor(config: OGComputeAdapterConfig) {
    if (!config.rpc) throw new Error('OGComputeAdapter: config.rpc is required');
    if (!config.privateKey) throw new Error('OGComputeAdapter: config.privateKey is required');
    if (!config.providerAddress)
      throw new Error('OGComputeAdapter: config.providerAddress is required');
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Internal: broker initialization (lazy, cached)
  // ---------------------------------------------------------------------------

  /**
   * Initializes and caches the 0G Compute broker bundle on first use.
   * Throws `OGComputeAdapter: broker not funded or not initialized` if the
   * broker cannot be set up — callers should surface this error as-is.
   */
  private async _getBroker(): Promise<BrokerBundle> {
    if (this._bundle !== null) return this._bundle;

    try {
      // Dynamic import — avoids hard-failing at module load if SDK is unavailable.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk = await import('@0glabs/0g-serving-broker') as any;
      const { ethers } = await import('ethers');

      const provider = new ethers.JsonRpcProvider(this.config.rpc);
      const wallet = new ethers.Wallet(this.config.privateKey, provider);

      // createZGComputeNetworkBroker auto-detects the network (testnet/mainnet)
      // from the RPC chain ID and resolves the correct contract addresses.
      const broker = await sdk.createZGComputeNetworkBroker(wallet) as BrokerBundle;
      this._bundle = broker;
      return broker;
    } catch (err) {
      // Re-throw with the canonical error message the interface contract requires.
      throw new Error(
        `OGComputeAdapter: broker not funded or not initialized — ${String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // IComputeAdapter
  // ---------------------------------------------------------------------------

  /**
   * Runs inference via 0G Compute.
   *
   * ### 0G-native: verifiable inference
   * When the provider is TeeML-verifiable, `verificationHash` is populated from
   * the `ZG-Res-Key` response header. This is a cryptographic proof anchored in
   * the TEE attestation chain — it can be independently verified on-chain.
   *
   * When the provider is not verifiable (or verification fails), `verificationHash`
   * is `undefined`. It is NEVER fabricated.
   */
  async chat(messages: ChatMessage[], options?: InferenceOptions): Promise<InferenceResult> {
    if (messages.length === 0) {
      throw new Error('OGComputeAdapter: messages array must not be empty');
    }

    for (const msg of messages) {
      if (typeof msg.content !== 'string' || msg.content.length === 0) {
        throw new Error(
          `OGComputeAdapter: message content must be a non-empty string, got: ${JSON.stringify(msg.content)}`,
        );
      }
    }

    const broker = await this._getBroker();
    const { providerAddress } = this.config;

    // Step 1: Resolve endpoint + model from provider's on-chain service registration.
    const { endpoint, model: providerModel } =
      await broker.inference.getServiceMetadata(providerAddress);

    const model = options?.model ?? this.config.model ?? providerModel;
    this._resolvedModel = model;

    // Step 2: Serialize the last user message for billing header content.
    // The billing header signs the content being charged — use the full last user turn.
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const billingContent = lastUserMsg?.content ?? '';

    // Step 3: Generate single-use billing headers signed by the wallet.
    // These headers carry the payment proof; the provider settles on-chain.
    const headers = await broker.inference.getRequestHeaders(providerAddress, billingContent);

    // Step 4: Call the OpenAI-compatible endpoint.
    const body = JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 2048,
    });

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 402 || response.status === 429) {
        throw new Error(
          `OGComputeAdapter: broker not funded or not initialized — HTTP ${response.status}: ${text}`,
        );
      }
      throw new Error(
        `OGComputeAdapter: inference request failed — HTTP ${response.status}: ${text}`,
      );
    }

    // Step 5: Parse response.
    // The ZG-Res-Key header carries the chat session ID used for TEE verification.
    const zgResKey = response.headers.get('ZG-Res-Key');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completion = await response.json() as any;

    const content: string = completion?.choices?.[0]?.message?.content ?? '';
    const usage = {
      promptTokens: completion?.usage?.prompt_tokens ?? 0,
      completionTokens: completion?.usage?.completion_tokens ?? 0,
      totalTokens: completion?.usage?.total_tokens ?? 0,
    };

    // Step 6: processResponse — verifies TEE proof, caches billing fee.
    // chatID is ZG-Res-Key if present, else fall back to completion.id.
    const chatID = zgResKey ?? completion?.id ?? undefined;
    const isValid = await broker.inference.processResponse(
      providerAddress,
      chatID,
      content,
    );

    // verificationHash: non-null only when the TEE proof verified successfully.
    // undefined when the provider is not verifiable or verification is inconclusive.
    // NEVER fabricated.
    const verificationHash =
      isValid === true && chatID !== undefined ? chatID : undefined;

    return { content, model, usage, verificationHash };
  }

  /**
   * Returns true if the broker can be initialized and the configured provider
   * is reachable. Returns false on any failure — does NOT throw.
   *
   * A false result means one of:
   *   - Wallet not funded (broker initialization failed)
   *   - Provider not acknowledged or not funded
   *   - Network / RPC unreachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const broker = await this._getBroker();
      const { endpoint } = await broker.inference.getServiceMetadata(
        this.config.providerAddress,
      );
      // A reachable endpoint returns at least an HTTP response (even 401/404 is fine).
      const res = await fetch(`${endpoint}/models`, { method: 'GET' });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Returns the model identifier for this adapter instance.
   * If `chat()` has been called at least once, returns the resolved provider model.
   * Otherwise returns the configured override, or a placeholder.
   */
  getModel(): string {
    return (
      this._resolvedModel ??
      this.config.model ??
      `0g-compute:${this.config.providerAddress.slice(0, 10)}…`
    );
  }
}
