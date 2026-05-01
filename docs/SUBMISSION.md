# ETHGlobal Open Agents — Submission

This document is what reviewers should read first to understand what 0G-Claw is, which tracks it qualifies for, and where to find each piece of the deliverable.

---

## Project

**0G-Claw** — a fork of [OpenClaw](https://github.com/openclaw/openclaw) that replaces local memory and centralized inference with 0G's decentralized stack. Same agent, any machine, with verifiable inference.

- **Repo:** https://github.com/DarienPerezGit/0G-CLAW
- **License:** MIT
- **Hackathon:** [ETHGlobal Open Agents](https://ethglobal.com/events/openagents)

---

## Tracks

| Track | Prize | Why we qualify |
|---|---|---|
| **🛠️ Best Agent Framework, Tooling & Core Extensions** | $7,500 | 0G-Claw extends OpenClaw with a stable adapter layer. The two interfaces (`IMemoryAdapter`, `IComputeAdapter`) are the integration point that lets any builder swap memory or compute backends without touching the core. We ship two production adapters (0G + local) for each surface and a working end-to-end agent that proves the contract is real |
| **🏷️ ENS AI Agents** | $2,500 | Each 0G-Claw agent is anchored to an ENS identity at creation. Memory root hashes and provider addresses are written to the agent's ENS text records. Status: 🔜 planned — track-specific work in flight, see [Status](#status) below |

Primary submission is the framework track. ENS is a bonus.

---

## What we built

The deliverable is a TypeScript framework, not a one-off agent. Three things, in order of importance:

1. **Adapter layer** — `IMemoryAdapter` and `IComputeAdapter` interfaces, with two implementations each (0G + local fallback). Located in [`adapters/`](../adapters/). These are the contract — anything else can change.
2. **Working basic agent** — [`examples/basic-agent/`](../examples/basic-agent/) — proves the adapter contracts compose into a real agent that persists across machines.
3. **Live integration tests against Galileo testnet** — `0GMemoryAdapter` and `0GComputeAdapter` are validated against the real network, not mocks. 21/21 compute tests passing.

What we explicitly did **not** do:
- We did not modify OpenClaw. The submodule is read-only.
- We did not invent a new SDK. We used `@0gfoundation/0g-ts-sdk` and `@0glabs/0g-serving-broker` as published.
- We did not gate the demo on live network availability — local fallbacks work without 0G credentials.

---

## 0G Protocol usage

| Component | Used for | Code reference |
|---|---|---|
| **0G Storage — KV Store** | Mutable session state, agent config | [`adapters/memory/0GMemoryAdapter.ts`](../adapters/memory/0GMemoryAdapter.ts) — `saveSession`, `loadSession`, `saveConfig`, `loadConfig` |
| **0G Storage — Log Store** | Append-only conversation history (replayable) | Same file — `appendMessage`, `loadHistory` |
| **0G Compute — Serving Broker** | LLM inference with TeeML verification proofs | [`adapters/compute/0GComputeAdapter.ts`](../adapters/compute/0GComputeAdapter.ts) — `chat()` returns `verificationHash` |
| **0G Chain (planned)** | ENS anchor for agent identity | Future: `adapters/identity/ENSIdentityAdapter.ts` |

SDKs:

- `@0gfoundation/0g-ts-sdk@^1.2.6` — storage
- `@0glabs/0g-serving-broker@^0.7.5` — compute
- `@ensdomains/ensjs@^4.0.2` — identity (ENS track)

---

## Status

Snapshot as of April 2026. Mirrors the table in the root [README.md](../README.md#what-works-today-april-2026).

| Component | Status | Notes |
|---|---|---|
| `IMemoryAdapter` / `IComputeAdapter` interfaces | ✅ | Stable, documented, tested |
| `0GMemoryAdapter` — KV | ✅ Live on Galileo | Integration tests pass against real testnet |
| `0GMemoryAdapter` — Log | ✅ Live on Galileo | Same |
| `0GComputeAdapter` | ✅ 21/21 live tests passing | Provider `0xa48f01287233509FD694a22Bf840225062E67836` (qwen/qwen-2.5-7b-instruct) |
| Compute broker funded | ✅ 3 OG | Ledger open, provider acknowledged |
| `LocalMemoryAdapter` + `LocalComputeAdapter` + `OpenAIComputeAdapter` | ✅ | Fallbacks for CI / no-creds environments |
| `examples/basic-agent` | ✅ | End-to-end working, both interactive and scripted modes |
| Docker single-container demo | ✅ | `./data/` survives `docker compose down` |
| ENS identity at agent creation | 🔜 in flight | ENS track deliverable |
| Multi-device validation (same wallet, two laptops) | 🔜 planned | Final acceptance test before submission |
| Demo video < 3 min | 🔜 planned | Script ready in [DEMO_SCRIPT.md](DEMO_SCRIPT.md) |

---

## Submission checklist (ETHGlobal requirements)

- [x] **Project name and description** — root [README.md](../README.md) and the top of this file
- [x] **Public GitHub repo** — https://github.com/DarienPerezGit/0G-CLAW (MIT licensed)
- [x] **README with setup instructions** — root [README.md](../README.md), section "Quickstart"
- [x] **Architecture diagram** — root README + [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [x] **At least one working example agent** — [`examples/basic-agent/`](../examples/basic-agent/)
- [x] **Which 0G features / SDKs used** — see [0G Protocol usage](#0g-protocol-usage) above
- [x] **Demo script** — [DEMO_SCRIPT.md](DEMO_SCRIPT.md) (3-minute structured flow)
- [ ] **Demo video (under 3 min)** — to be recorded against the script
- [ ] **Live demo link** — TBD
- [ ] **Contract deployment addresses** — pending ENS integration; the 0G Compute provider address `0xa48f01287233509FD694a22Bf840225062E67836` is documented in `.env.example`
- [x] **Team contact info** — [Team](#team)

---

## Team

| Name | Role | Contact |
|---|---|---|
| **Darien Pérez** | Adapter layer, 0G integration, live testnet validation | [@DarienPerezGit](https://github.com/DarienPerezGit) |
| **Juan Chaparro** | Demo readiness, Docker, documentation | jchaparro@pluszero.app |

---

## Reviewer quickstart

If you're judging and want to verify the project end-to-end in under 5 minutes:

```bash
git clone https://github.com/DarienPerezGit/0G-CLAW.git
cd 0G-CLAW
pnpm install
pnpm build         # confirms TypeScript compiles, contracts are real

# Without 0G creds — confirms the architecture works locally:
pnpm example:basic

# With 0G memory creds (RPC + indexer + private key in .env):
MEMORY_ADAPTER=0g pnpm example:basic

# Confirm 0G Compute test suite:
pnpm test adapters/compute
```

For a guided live demo, follow [DEMO_SCRIPT.md](DEMO_SCRIPT.md). For deeper architecture context, [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Why this is more than a demo

OpenClaw is one of many local-first agent frameworks. What 0G-Claw adds is a clean **infrastructure primitive**: a TypeScript contract that says "here's what a memory backend must do, here's what a compute backend must do," with two implementations of each that prove the contract works.

Other builders can:

- Implement `IMemoryAdapter` against Filecoin, IPFS, Arweave, Redis — drop-in replaceable
- Implement `IComputeAdapter` against any inference provider that returns content + (optionally) a verification proof
- Reuse our `0GMemoryAdapter` and `0GComputeAdapter` directly in their own agents — they're not coupled to OpenClaw

That portability is why we believe this qualifies for the framework track specifically. The example agent is a proof of correctness; the framework is the deliverable.
