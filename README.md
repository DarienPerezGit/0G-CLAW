# 0G-Claw 🦞⚡

> **OpenClaw, but your agent never forgets — and never depends on Big Tech.**

0G-Claw is a fork/extension of [OpenClaw](https://github.com/openclaw/openclaw) that replaces its centralized dependencies with [0G's](https://0g.ai) decentralized infrastructure stack. Session memory moves from local disk to **0G Storage (KV/Log)**. LLM inference moves from OpenAI/Anthropic to **0G Compute** (Qwen3, GLM-5). The result: a portable, sovereign AI assistant that runs the same — from any machine, forever.

Built for [ETHGlobal Open Agents](https://ethglobal.com/events/openagents) — Track: 🛠️ Best Agent Framework, Tooling & Core Extensions.

---

## The Problem

OpenClaw is great. But it has two hard dependencies:

| Problem | OpenClaw Today | 0G-Claw |
|---|---|---|
| **Memory** | Lives in `~/.openclaw/agents/<id>/sessions/*.jsonl` — lose the disk, lose the agent | Persists in **0G Storage KV/Log** — portable across any device |
| **Inference** | Routes to OpenAI / Anthropic APIs — centralized, censorable, opaque | Routes to **0G Compute** — open models (Qwen3, GLM-5), verifiable inference |

**The pitch:** Same agent, any machine, no vendor lock-in.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     0G-Claw                         │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │              OpenClaw Core                  │   │
│  │   (Gateway, channels, session management)   │   │
│  └──────────────┬──────────────────────────────┘   │
│                 │ adapter interfaces                │
│        ┌────────┴─────────┐                        │
│        ▼                  ▼                        │
│  ┌──────────────┐  ┌───────────────┐               │
│  │  0GMemory    │  │  0GCompute    │               │
│  │  Adapter     │  │  Adapter      │               │
│  │              │  │               │               │
│  │ KV Store:    │  │ Models:       │               │
│  │ - sessions   │  │ - qwen3-plus  │               │
│  │ - agent state│  │ - GLM-5-FP8   │               │
│  │              │  │               │               │
│  │ Log Store:   │  │ Endpoint:     │               │
│  │ - history    │  │ 0G proxy API  │               │
│  └──────┬───────┘  └──────┬────────┘               │
│         │                 │                        │
└─────────┼─────────────────┼────────────────────────┘
          ▼                 ▼
   ┌─────────────┐   ┌─────────────┐
   │  0G Storage │   │  0G Compute │
   │  (mainnet / │   │  (mainnet / │
   │   testnet)  │   │   testnet)  │
   └─────────────┘   └─────────────┘
```

### Key Design Principle

The adapter interfaces are the extension point. You can swap `0GMemoryAdapter` for `RedisMemoryAdapter` or `LocalMemoryAdapter` without touching OpenClaw core. Same for compute: swap `0GComputeAdapter` for `OllamaAdapter` or `OpenAIAdapter`. The agent doesn't know the difference.

---

## Repo Structure

```
0g-claw/
├── adapters/
│   ├── memory/
│   │   ├── 0GMemoryAdapter.ts      # 0G Storage KV/Log implementation
│   │   ├── LocalMemoryAdapter.ts   # Fallback (original OpenClaw behavior)
│   │   └── IMemoryAdapter.ts       # Interface — swap anything here
│   └── compute/
│       ├── 0GComputeAdapter.ts     # 0G Compute / proxy API
│       ├── OpenAIComputeAdapter.ts # Fallback
│       └── IComputeAdapter.ts      # Interface
├── examples/
│   └── basic-agent/                # Working example agent using the framework
│       ├── agent.ts
│       └── README.md
├── scripts/
│   └── setup.sh                    # Testnet setup helper
├── docs/
│   └── architecture.md
├── openclaw/                       # OpenClaw as git submodule
├── .env.example
├── package.json
└── README.md                       # This file
```

---

## Quickstart

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- A wallet with 0G testnet tokens (see Setup below)

### 1. Clone & install

```bash
git clone https://github.com/DarienPerezGit/0G-CLAW.git
cd 0G-CLAW
pnpm install
```

### 2. Get 0G testnet tokens

1. Go to [build.0g.ai](https://build.0g.ai) and create an account
2. Connect your wallet (MetaMask or similar EVM wallet)
3. Use the faucet to get testnet tokens on 0G Chain
4. Copy your private key — you'll need it in `.env`

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# 0G Storage
OG_STORAGE_RPC=https://evmrpc-testnet.0g.ai
OG_STORAGE_INDEXER=https://indexer-storage-testnet-standard.0g.ai
OG_PRIVATE_KEY=your_wallet_private_key

# 0G Compute
OG_COMPUTE_ENDPOINT=https://api.0g.ai/v1
OG_COMPUTE_MODEL=qwen3-plus         # or GLM-5-FP8

# OpenClaw (keep your existing config)
OPENCLAW_WORKSPACE=~/.openclaw
```

### 4. Run the example agent

```bash
pnpm example:basic
```

The agent will boot, load its memory from 0G Storage, and be ready. Kill the process, run it again on a different machine with the same wallet — memory is still there.

---

## Adapters

### 0GMemoryAdapter

Replaces OpenClaw's local file-based session storage with 0G Storage KV/Log.

**What gets stored where:**

| Data | Storage type | Key pattern |
|---|---|---|
| Active session state | KV Store | `session:{agentId}:{sessionId}` |
| Conversation history | Log Store | append-only, by session |
| Agent config (AGENTS.md) | KV Store | `config:{agentId}` |

**Usage:**

```typescript
import { OGMemoryAdapter } from '0g-claw/adapters/memory';

const memory = new OGMemoryAdapter({
  rpc: process.env.OG_STORAGE_RPC,
  indexer: process.env.OG_STORAGE_INDEXER,
  privateKey: process.env.OG_PRIVATE_KEY,
});

// Drop-in replacement anywhere OpenClaw reads/writes sessions
```

### 0GComputeAdapter

Routes LLM inference to 0G Compute instead of OpenAI/Anthropic. Compatible with the OpenAI API interface that OpenClaw already uses internally.

```typescript
import { OGComputeAdapter } from '0g-claw/adapters/compute';

const compute = new OGComputeAdapter({
  endpoint: process.env.OG_COMPUTE_ENDPOINT,
  model: process.env.OG_COMPUTE_MODEL, // 'qwen3-plus' | 'GLM-5-FP8'
});
```

Available models on 0G Compute (as of April 2026):
- `qwen3.6-plus`
- `GLM-5-FP8`
- `qwen3-VL` (multimodal)

---

## ENS Integration (Bonus)

Each 0G-Claw agent gets an ENS identity at creation time. This makes agents discoverable by name instead of by wallet address.

```typescript
// At agent creation:
// agent.ens = `my-agent.0gclaw.eth`
// Stored in ENS text records: { "0gclaw.memory": "<0G KV root hash>" }
```

This is optional but qualifies for the ENS track ($2,500).

---

## Roadmap (Hackathon Scope)

### Week 1 — Core (Days 1–7)
- [ ] `IMemoryAdapter` interface defined
- [ ] `0GMemoryAdapter` — KV write/read for sessions
- [ ] `0GMemoryAdapter` — Log append for history
- [ ] `IComputeAdapter` interface defined
- [ ] `0GComputeAdapter` — working inference via proxy API
- [ ] OpenClaw integration — adapters hooked into OpenClaw session layer
- [ ] Basic example agent running end-to-end

### Week 2 — Polish (Days 8–12)
- [ ] ENS identity at agent creation
- [ ] Multi-device test (same agent, two machines, same memory)
- [ ] Error handling + fallback to local adapters
- [ ] Architecture diagram
- [ ] Demo video (under 3 min)
- [ ] Docs + README finalized

---

## Why Not Just Use LangChain?

LangChain and CrewAI assume a coordinator — a central process that orchestrates everything. OpenClaw is personal and local-first. 0G-Claw keeps that philosophy but makes the persistence layer decentralized. You're not building a pipeline, you're building a persistent agent that happens to use decentralized infra under the hood.

---

## 0G Protocol Usage

| Component | What we use | Why |
|---|---|---|
| 0G Storage — KV Store | Session state, agent config | Fast read/write, key-value access pattern |
| 0G Storage — Log Store | Conversation history | Append-only, immutable history |
| 0G Compute | LLM inference | Open models, verifiable, no API key to OpenAI |
| 0G Chain | (ENS integration anchor) | On-chain agent identity |

SDK: `@0glabs/0g-ts-sdk`

---

## Team

| Name | Role | Contact |
|---|---|---|
| [Socio A] | Core / OpenClaw integration | @handle |
| [Socio B] | Infra / 0G adapters | @handle |

---

## Submission Checklist

- [ ] Project name and description ✅ (this README)
- [ ] Contract deployment addresses (ENS + 0G Chain)
- [ ] Public GitHub repo with README + setup instructions ✅
- [ ] Demo video (under 3 min)
- [ ] Live demo link
- [ ] Which protocol features/SDKs used ✅ (see table above)
- [ ] Team contact info
- [ ] At least one working example agent ✅ (`examples/basic-agent/`)
- [ ] Architecture diagram ✅ (see above)

---

## License

MIT
