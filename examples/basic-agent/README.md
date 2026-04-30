# basic-agent

End-to-end demo agent that exercises the full 0G-Claw adapter layer. This is the reference implementation reviewers should run.

What it demonstrates:

- **Adapter swappability** — picks `LocalMemoryAdapter` / `OGMemoryAdapter` and `LocalComputeAdapter` / `0GComputeAdapter` at runtime via env vars, with no code changes
- **Session persistence** — loads any prior `SESSION_ID` on startup and appends messages after every turn
- **Replay across processes / machines** — same wallet + same `SESSION_ID` resumes the same conversation, regardless of where it was last run
- **Verifiable inference** — when backed by 0G Compute, prints the `verificationHash` (0G TeeML proof) returned by the provider
- **Graceful fallback** — missing 0G env vars trigger an explicit fallback to local adapters with a clear log line; the agent never crashes silently

---

## Run modes

| Mode | Memory | Compute | Use it for |
|---|---|---|---|
| `pnpm example:basic` | local filesystem | local stub | Smoke test on any machine, no creds needed |
| `MEMORY_ADAPTER=0g pnpm example:basic` | 0G Storage | local stub | **Demo path A** — proves decentralized memory persistence |
| `COMPUTE_ADAPTER=0g pnpm example:basic` | local filesystem | 0G Compute | **Demo path B** — proves verifiable inference |
| `MEMORY_ADAPTER=0g COMPUTE_ADAPTER=0g pnpm example:basic` | 0G Storage | 0G Compute | Fully decentralized — all four 0G capabilities active |

Production build path (compiled JS, used inside the Docker image):

```bash
pnpm build
pnpm example:basic:prod
```

---

## Environment variables

| Variable | Default | Required for | Notes |
|---|---|---|---|
| `MEMORY_ADAPTER` | `local` | — | `local` or `0g` |
| `COMPUTE_ADAPTER` | `local` | — | `local` or `0g` |
| `AGENT_ID` | `claw-agent-0` | — | Identity string used to scope memory keys |
| `SESSION_ID` | `session-<random>` | Resuming a prior session | Pass the same value to continue an existing conversation |
| `OG_STORAGE_RPC` | from `.env` | `MEMORY_ADAPTER=0g`, `COMPUTE_ADAPTER=0g` | EVM RPC for 0G chain (Galileo testnet) |
| `OG_STORAGE_INDEXER` | from `.env` | `MEMORY_ADAPTER=0g` | Storage indexer endpoint |
| `OG_PRIVATE_KEY` | from `.env` | `MEMORY_ADAPTER=0g`, `COMPUTE_ADAPTER=0g` | Wallet that signs storage / broker transactions |
| `OG_COMPUTE_PROVIDER` | from `.env` | `COMPUTE_ADAPTER=0g` | Provider address (see `.env.example` for active providers) |

Any required variable that is missing triggers a fallback message and the agent runs against the local adapter for that channel. **No silent failures.**

---

## Resuming a session

Every run prints a "to resume" line at the end:

```
  To resume this session from any machine:
    SESSION_ID=session-1a2b3c4d MEMORY_ADAPTER=0g pnpm example:basic
```

Paste that command on any machine that has the same `OG_PRIVATE_KEY` and you continue the same conversation. This is the headline demo: same agent, any machine.

---

## Interactive vs scripted mode

The agent detects whether stdin is a TTY:

- **TTY (your terminal)** — reads from stdin, type messages until you send `exit` or Ctrl+C
- **Non-TTY (Docker, CI, piped input)** — runs a hardcoded set of scripted exchanges and exits

Both modes persist messages identically. The Docker-friendly scripted mode is what runs inside `docker compose up`.

---

## Output highlights

Each turn prints:

```
[user] <your message>
[agent] <model response>
        model: qwen/qwen-2.5-7b-instruct | tokens: 187
        verificationHash: 0xabc… (0G TeeML proof)   ← only when COMPUTE_ADAPTER=0g
```

`verificationHash` is the cryptographic proof that the response came from the acknowledged provider. It's the answer to "how do I trust this isn't a centralized model behind a proxy?"

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `MEMORY_ADAPTER=0g but OG_STORAGE_RPC … are missing` | `.env` not loaded or values blank | Fill `.env`, or accept the local fallback |
| `compute error: broker not funded or not initialized` | Wallet has no broker ledger or 0 balance | Run `pnpm setup:broker` (one-time) — see [README.md](../../README.md#0g-compute--broker-funding-requirements) |
| `Indexer upload failed` / timeout | Galileo Storage node temporarily slow | Retry, or run with `MEMORY_ADAPTER=local` for the demo |
| `provider acknowledgement required` | Wallet hasn't acknowledged the provider signer | `pnpm setup:broker` covers this; alternatively call `broker.inference.acknowledgeProviderSigner(provider)` manually |

---

## Where memory ends up

| Adapter | Storage location |
|---|---|
| `LocalMemoryAdapter` | `~/.0g-claw/<AGENT_ID>/sessions/*.json` and `…/history/*.jsonl` |
| Inside Docker (default) | `./data/<AGENT_ID>/…` on the host (mounted to `/app/.0g-claw` via `HOME=/app`) |
| `0GMemoryAdapter` | 0G Storage KV (sessions) + Log (history), keyed by `${AGENT_ID}:${SESSION_ID}` |

For the 0G case, the actual KV root hash is what you'd anchor in ENS for the planned identity track.
