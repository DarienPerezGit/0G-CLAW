# 0G-Claw 🦞⚡

> **OpenClaw, but your agent never forgets — and never depends on Big Tech.**

0G-Claw is a fork/extension of [OpenClaw](https://github.com/openclaw/openclaw) that replaces its centralized dependencies with [0G's](https://0g.ai) decentralized infrastructure stack. Session memory moves from local disk to **0G Storage (KV/Log)**. LLM inference moves from OpenAI/Anthropic to **0G Compute** (Qwen3, GLM-5). The result: a portable, sovereign AI assistant that runs the same — from any machine, forever.

Built for [ETHGlobal Open Agents](https://ethglobal.com/events/openagents) — Track: 🛠️ Best Agent Framework, Tooling & Core Extensions.

> **Live submission landing**: open [`pitch/index.html`](pitch/index.html) in any browser, or deploy `/pitch` to GitHub Pages / Vercel / Netlify. The page is the public face of the project — hero, architecture, capabilities, demo video, copy-paste quickstart. Internal team planning lives in [`team-plan/`](team-plan/).

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
│   ├── basic-agent/                # Conversational chat agent (chat loop)
│   │   ├── agent.ts
│   │   └── README.md
│   └── research-agent/             # Topic-driven research pipeline (plan → research → synthesize)
│       ├── agent.ts
│       ├── README.md
│       ├── lib/                    # topicId, prompts, types
│       └── tools/                  # WikipediaSearchTool, MemoryRecallTool, ITool
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

### 4. Run an example agent

The repo ships **two reference agents** built on the same adapter layer — proof that 0G-Claw is a framework, not a single-use codebase.

```bash
# Conversational chat loop — basic-agent
pnpm example:basic

# Topic-driven research pipeline — research-agent
RESEARCH_TOPIC="0G Protocol architecture" pnpm example:research
```

Both agents share the same `IMemoryAdapter` and `IComputeAdapter`. Both fall back to local adapters when 0G credentials are missing. Kill either process, run it again on a different machine with the same wallet — memory is still there. See [`examples/basic-agent/README.md`](examples/basic-agent/README.md) and [`examples/research-agent/README.md`](examples/research-agent/README.md) for details.

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
  model: process.env.OG_COMPUTE_MODEL, // 'qwen/qwen-2.5-7b-instruct'
});
```

Active provider on Galileo testnet (validated April 2026):
- `qwen/qwen-2.5-7b-instruct` via provider `0xa48f01287233509FD694a22Bf840225062E67836`
- Endpoint: `https://compute-network-6.integratenetwork.work/v1/proxy`

To set up the broker (one-time, requires funded wallet):

```bash
pnpm setup:broker
```

> **Note:** Basic-agent full 0G mode (both `MEMORY_ADAPTER=0g` and `COMPUTE_ADAPTER=0g`) depends on Galileo Storage node availability. If the network is slow, storage uploads may stall. For demos, prefer pre-existing sessions or run with `COMPUTE_ADAPTER=0g` alone.

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

## Status (April 2026)

| Component | Status |
|---|---|
| `IMemoryAdapter` interface | ✅ defined |
| `0GMemoryAdapter` — KV write/read for sessions | ✅ live on Galileo testnet |
| `0GMemoryAdapter` — Log append for history | ✅ live on Galileo testnet |
| `IComputeAdapter` interface | ✅ defined |
| `0GComputeAdapter` — inference via 0G Compute proxy | ✅ 21/21 live tests passing |
| Compute broker — ledger funded, provider acknowledged | ✅ 3 OG ledger, provider `0xa48f01…` |
| OpenClaw integration — adapters hooked into session layer | ✅ working example agent |
| Basic example agent running end-to-end | ✅ (`examples/basic-agent/`) |
| Fallback to local adapters | ✅ `LocalMemoryAdapter` + `OpenAIComputeAdapter` |
| ENS identity at agent creation | 🔜 planned |
| Multi-device test (same wallet, two machines) | 🔜 planned |
| Demo video (under 3 min) | 🔜 planned |

### Demo Strategy

For live demos, use this order to avoid network instability blocking the presentation:

1. **Primary**: Show 0G Memory persistence with a pre-existing session + local compute fallback
2. **Proof section**: Show `0GComputeAdapter` live test output (21/21 passed), provider/broker setup, `verificationHash` from test results
3. **Optional live**: Run `COMPUTE_ADAPTER=0g` only if `pnpm run check:testnet` shows the network is healthy

This prevents a slow Galileo Storage node from blocking a demo that is technically already fully validated.

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
