# Architecture

This document describes how 0G-Claw is structured, what each layer is responsible for, and where the 0G-native capabilities surface in the code.

The audience is contributors and ETHGlobal reviewers. For setup and run instructions, see the root [README.md](../README.md).

---

## High-level diagram

```
┌──────────────────────────────────────────────────────────────┐
│                      OpenClaw Core                           │
│   (gateway, channels, session management — git submodule)    │
└────────────────────────────┬─────────────────────────────────┘
                             │
                  ┌──────────┴──────────┐
                  │   Adapter contracts │   ◄── extension surface
                  │   (TypeScript IFs)  │
                  └──────────┬──────────┘
                             │
                ┌────────────┼────────────┐
                ▼                         ▼
        ┌───────────────┐         ┌───────────────┐
        │ IMemoryAdapter│         │IComputeAdapter│
        └───────┬───────┘         └───────┬───────┘
        ┌───────┴────────┐         ┌──────┴────────┐
        ▼                ▼         ▼               ▼
  0GMemoryAdapter  LocalMemory  0GCompute   LocalCompute /
                   Adapter      Adapter     OpenAICompute
        │                              │
        ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│ 0G Storage       │          │ 0G Compute       │
│  - KV  (sessions)│          │  - serving broker│
│  - Log (history) │          │  - TeeML proofs  │
└──────────────────┘          └──────────────────┘
```

The contract is the interface. Anything that implements `IMemoryAdapter` plugs in. Anything that implements `IComputeAdapter` plugs in. OpenClaw doesn't know which adapter is active.

---

## Adapter contracts

The two interfaces are the only thing OpenClaw depends on. Adapters are the only files that touch 0G infrastructure.

### `IMemoryAdapter`

Defined in [`adapters/memory/IMemoryAdapter.ts`](../adapters/memory/IMemoryAdapter.ts).

| Method | Surface | Purpose |
|---|---|---|
| `saveSession(session)` | KV | Overwrites the session state at `session:{agentId}:{sessionId}` |
| `loadSession(agentId, sessionId)` | KV | Returns session state or `null` |
| `listSessions(agentId)` | KV | Lists every session ever created for an agent |
| `deleteSession(agentId, sessionId)` | KV | Removes session state — does not affect history |
| `appendMessage(agentId, sessionId, message)` | Log | Append-only; implementations MUST NOT allow mutation |
| `loadHistory(agentId, sessionId)` | Log | Returns the full ordered message log |
| `saveConfig(agentId, config)` | KV | Stores the agent config (AGENTS.md equivalent) |
| `loadConfig(agentId)` | KV | Retrieves the config blob |

The split between KV (mutable state) and Log (immutable history) is intentional. Sessions evolve; history is the audit trail. The Log surface is what makes **replayable agent execution** possible.

### `IComputeAdapter`

Defined in [`adapters/compute/IComputeAdapter.ts`](../adapters/compute/IComputeAdapter.ts).

| Method | Purpose |
|---|---|
| `chat(messages, options?)` | Runs inference, returns content + usage + (optional) `verificationHash` |
| `healthCheck()` | Returns `false` on failure — must not throw |
| `getModel()` | Returns the model identifier this adapter instance is configured for |

`InferenceResult.verificationHash` is the lever for **verifiable inference**. Only `0GComputeAdapter` ever populates it. The contract is explicit that non-0G adapters MUST return `undefined` — no fabrication, no simulation. That preserves the trust property end-to-end.

---

## 0G-native capabilities, mapped to code

These four properties are the technical differentiator versus a vanilla OpenClaw fork:

| Capability | Where it lives | How it's wired |
|---|---|---|
| **Verifiable inference** | `0GComputeAdapter` | Returns `verificationHash` from the 0G TeeML proof on every call. Surfaced to the user in `examples/basic-agent/agent.ts` after each turn |
| **Shared memory across agents** | `0GMemoryAdapter` | KV/Log keys are derived from `${agentId}:${sessionId}`. Multiple agent processes pointed at the same wallet read/write the same state |
| **Replayable agent execution** | `IMemoryAdapter.loadHistory` + Log Store | The log is append-only. `loadHistory` returns the full ordered message stream — sufficient to reconstruct any session from scratch |
| **Portable agent identity** | `OG_PRIVATE_KEY` (today) → ENS records (planned) | The wallet **is** the identity. Every adapter writes/reads under the wallet's namespace, so the same wallet on a new machine sees the same agent |

If a feature doesn't surface at least one of these, it doesn't belong in 0G-Claw — it belongs upstream in OpenClaw.

---

## Data flow — a single agent turn

```
user input
   │
   ▼
┌──────────────────────────┐
│ basic-agent.ts           │
│  ↓                        │
│  contextWindow.push(user)│
│  persistMessage(user)    │ ──► IMemoryAdapter.saveSession() + appendMessage()
│                          │      (KV update + Log append)
│  compute.chat(window)    │ ──► IComputeAdapter.chat()
│                          │      (returns content + verificationHash)
│  contextWindow.push(asst)│
│  persistMessage(asst)    │ ──► IMemoryAdapter.saveSession() + appendMessage()
│  print(content, hash)    │
└──────────────────────────┘
```

Every turn writes to KV (latest session state) **and** Log (immutable record). On restart, `loadSession` rebuilds the in-memory window in O(1); `loadHistory` is available for audit / replay.

---

## Deferred execution in `0GComputeAdapter`

The 0G compute path is more involved than a single API call. Before any inference, the wallet must:

1. Hold ≥ 3 OG on Galileo testnet
2. Have an open broker ledger (`broker.ledger.addLedger`)
3. Have acknowledged the provider's signer
4. Have transferred funds to that provider

`0GComputeAdapter` solves this with a **deferred execution** pattern:

- **Construction is cheap.** No network calls, no broker init. The adapter can be instantiated in any environment.
- **First `chat()` call resolves provider metadata** (model name, endpoint URL) from the broker, caches it, then issues the request.
- **Errors are explicit.** Missing funds → "broker not funded or not initialized", which the basic-agent surfaces verbatim with a hint to run `pnpm setup:broker`.

This is what lets the agent boot in CI, Docker, or a fresh laptop without 0G credentials and still pass `pnpm build` / smoke tests. The 0G dependency only matters at the moment a real inference is requested.

The flip side: a misconfigured broker doesn't fail at startup, it fails on first inference. The `pnpm check:testnet` script exists to catch that earlier — see [`scripts/check-testnet.ts`](../scripts/check-testnet.ts).

---

## Local fallback adapters

Both `LocalMemoryAdapter` and `LocalComputeAdapter` (and `OpenAIComputeAdapter`) implement the same interfaces. They exist for three reasons:

1. **Smoke testing** without 0G credentials (CI, fresh checkout)
2. **Demo continuity** when Galileo testnet is slow — the demo shows the architecture works, even if the network blip prevents a live 0G call
3. **Validation that the contract is real** — if the interface only had one implementer, it wouldn't be a contract, it would be coupling

`LocalMemoryAdapter` writes to `${HOME}/.0g-claw/<agentId>/...`. That's the path the Docker image is configured to mount as a volume — see below.

---

## Docker layout

```
host                            container
─────                           ─────────
./data/  ◄──── volume ────►     /app/.0g-claw/
                                  └── claw-agent-0/
                                       ├── sessions/*.json
                                       └── history/*.jsonl
.env     ◄──── env_file ───►    process.env
```

Two pieces wire this up in [`docker-compose.yml`](../docker-compose.yml):

- `volumes: ./data:/app/.0g-claw` — the local memory mount
- `environment: HOME=/app` — pins the container's home directory so `LocalMemoryAdapter`'s default `${HOME}/.0g-claw` resolves to `/app/.0g-claw`, matching the volume

Without `HOME=/app`, the default home for the root user is `/root`, and writes would land in `/root/.0g-claw` — outside the volume, which means data would not persist across `docker compose down`. The `HOME=/app` line is the contract that keeps the documented mount path correct.

Files in `./data/` end up owned by root on the host, because the container runs as root. To wipe state for a clean demo: `sudo rm -rf data/`.

---

## Boundaries — what does NOT belong where

| Concern | Belongs in | Does NOT belong in |
|---|---|---|
| 0G SDK calls | `adapters/memory/0GMemoryAdapter.ts`, `adapters/compute/0GComputeAdapter.ts` | OpenClaw core, examples, scripts |
| Filesystem writes | `adapters/memory/LocalMemoryAdapter.ts` | OpenClaw core, examples |
| Adapter selection logic | `examples/basic-agent/agent.ts` (env-var dispatch) | Adapters themselves — adapters take config via constructor |
| Network endpoints / wallet keys | `.env` + `.env.example` | Source files — checked by `.gitignore` |
| OpenClaw modifications | Upstream OpenClaw repo, never this fork | The `openclaw/` submodule — treat as read-only |

If you find yourself wanting to break one of these boundaries, the right move is almost always to extend the interface, not to reach across layers.

---

## Future work

| Item | Where it'll land |
|---|---|
| ENS identity at agent creation | New module `adapters/identity/ENSIdentityAdapter.ts`, plus a small hook in basic-agent |
| Multi-device live test (same wallet, two laptops) | `docs/DEMO_SCRIPT.md` — already in the demo plan |
| Streaming inference (`chat` → `chatStream`) | `IComputeAdapter` — additive, won't break existing callers |
| Multiple agents on shared memory | Already supported by the interface; add an example under `examples/` |

Each of these is additive against the existing contracts. None require changing what's there — that's the point of the adapter pattern.
