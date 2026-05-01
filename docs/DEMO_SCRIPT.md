# 3-Minute Demo Script

This is the live demo flow for 0G-Claw. It's designed for ETHGlobal Open Agents judging — short, concrete, and resilient to testnet hiccups.

**Goal of the demo:** prove that 0G-Claw makes an OpenClaw agent (a) keep its memory across machines via 0G Storage, and (b) run inference verifiably via 0G Compute, with both paths individually validated against the live Galileo testnet.

**Total time budget:** 3:00. The script below leaves ~10s of slack.

---

## Pre-flight (do before recording / presenting)

These are not part of the 3 minutes. Verify everything before going live.

- [ ] `pnpm install && pnpm build` clean
- [ ] `pnpm check:testnet` reports RPC + indexer reachable
- [ ] Wallet ≥ 3 OG on Galileo testnet — [faucet.0g.ai](https://faucet.0g.ai)
- [ ] Broker funded — `pnpm setup:broker` has been run for `OG_COMPUTE_PROVIDER`
- [ ] `0GComputeAdapter` test suite green: `pnpm test adapters/compute` shows 21/21 passing — keep that terminal open in a second window for the proof beat
- [ ] At least one prior session exists in 0G Storage that the demo will resume — recommended: run `MEMORY_ADAPTER=0g pnpm example:basic` once, copy the printed `SESSION_ID`, jot it down
- [ ] `.env` has all required values filled in

> **Why this matters:** the demo's risk surface is the live network, not the code. If Galileo Storage is slow on the day of the demo, the optional live-compute beat (act 3) gets cut. The first two beats don't depend on live network calls during the recording.

---

## Act 1 — The hook (0:00–0:30)

**Visual:** terminal, project tree visible on the side, README open in a second pane.

**Say:**

> "OpenClaw is a great personal AI assistant — but its memory lives on your laptop's disk. Lose the laptop, lose the agent. Its inference goes to OpenAI or Anthropic — centralized, censorable, opaque.
>
> 0G-Claw fixes both. Memory moves to 0G Storage. Inference moves to 0G Compute. Same agent, any machine, with cryptographic proof that the model actually ran."

**Show on screen** (just point at the README table):

```
Memory     local disk        →  0G Storage KV/Log
Inference  OpenAI/Anthropic  →  0G Compute (verifiable)
```

---

## Act 2 — The headline demo: portable memory (0:30–1:45)

This is the act that absolutely has to land. It does not depend on live 0G Compute, only on 0G Storage reads/writes — which are tested live and stable.

**Visual:** split terminal — left "machine A", right "machine B" (can be two shells on the same host with different `pwd`).

### A1 — Start fresh (0:30–0:50)

```bash
# machine A
MEMORY_ADAPTER=0g pnpm example:basic
```

Type a couple of distinctive messages to the agent. Use something memorable, e.g.:

```
[you] My name is Juan and I'm building 0G-Claw with Darien.
[you] Remember the model number XJ-742.
```

Wait for the agent to print:

```
To resume this session from any machine:
    SESSION_ID=session-1a2b3c4d MEMORY_ADAPTER=0g pnpm example:basic
```

Copy that line. **Kill the process** (Ctrl+C).

### A2 — Resume from "another machine" (0:50–1:25)

Switch to the right pane. Cite that this is a different shell, different working directory — could just as easily be a different laptop with the same `OG_PRIVATE_KEY`.

Paste the resume command:

```bash
SESSION_ID=session-1a2b3c4d MEMORY_ADAPTER=0g pnpm example:basic
```

The agent boot output should show:

```
[agent] resumed session with N message(s) in state
```

Now ask it something that requires recall:

```
[you] What's the model number I told you?
```

The agent should answer with `XJ-742`. **This is the moment.** Memory just survived a full process death and was reloaded from 0G Storage on a different shell.

**Say:**

> "Same wallet, new process. The agent loaded its memory from 0G Storage — nothing on disk. This is what 'portable agent identity' means as a primitive."

### A3 — Show the storage path (1:25–1:45)

Open `docs/ARCHITECTURE.md` to the "0G-native capabilities" table or the data-flow diagram. Point at:

> "Sessions in KV. History in append-only Log. The Log is what makes this **replayable** — any session can be reconstructed from scratch by anyone with the wallet."

Mention briefly that this is the foundation for **shared memory across agents** — multiple processes pointed at the same key namespace see the same state.

---

## Act 3 — Verifiable inference (1:45–2:30)

The stable version of this beat is "show the proof", not "run live". Show 21/21 tests passing in the proof window.

### B1 — The proof window (1:45–2:10)

Bring up the second terminal that has:

```
✓ adapters/compute/0GComputeAdapter.live.test.ts (21 tests) PASSED
  ✓ chat() returns content + verificationHash
  ✓ broker ledger funded — 3 OG
  ✓ provider 0xa48f01... acknowledged
  ...
```

**Say:**

> "Every chat through `0GComputeAdapter` returns a verification hash — a TeeML proof from the 0G Compute provider. Twenty-one integration tests assert that hash exists and validates against the acknowledged provider signer. This isn't a mocked OpenAI — it's verifiable inference."

Optionally cat one test output line and highlight the `verificationHash: 0x…` field.

### B2 — Optional live call (2:10–2:30)

**Only if** `pnpm check:testnet` is green and the network looked healthy in pre-flight:

```bash
COMPUTE_ADAPTER=0g pnpm example:basic
```

Send one prompt. Point at the printed:

```
[agent] <response>
        model: qwen/qwen-2.5-7b-instruct | tokens: 187
        verificationHash: 0xabc... (0G TeeML proof)
```

If the network is slow → skip this. The proof window from B1 already covered it.

> **Trade-off note:** The 21/21 test run is the durable artifact; the live call is a flourish. If the testnet is degraded the day of the demo, ditch B2 and recover the time in Act 4.

---

## Act 4 — Resilience: fallbacks (2:30–2:50)

**Say:**

> "If 0G is unavailable, the agent doesn't crash — it falls back to local adapters with a single env-var change. Same interface, same code path."

```bash
MEMORY_ADAPTER=local COMPUTE_ADAPTER=local pnpm example:basic
```

Boot output:

```
Memory backend: local filesystem
[agent] compute model: local-stub
```

This shows the architecture is real — the contract is the interface, not the implementation. Mention that this is also what runs in CI and inside Docker without credentials.

---

## Act 5 — Close (2:50–3:00)

**Say:**

> "Two adapters, four 0G-native capabilities — verifiable inference, shared memory, replayable execution, portable identity. OpenClaw didn't change. We didn't fork the core. We just made the persistence layer decentralized.
>
> 0G-Claw is on GitHub, MIT-licensed, with a working agent and integration tests. Thank you."

Cut to the GitHub URL or QR code on the closing slide.

---

## Cheat sheet — single-screen prompt cards

```
ACT 1  HOOK             "OpenClaw with decentralized memory + compute"
ACT 2  PORTABLE MEMORY  MEMORY_ADAPTER=0g pnpm example:basic
                        kill, resume from new shell, ask recall question
ACT 3  VERIFIABLE INF.  show 21/21 test pass, point at verificationHash
                        (optional live: COMPUTE_ADAPTER=0g if network green)
ACT 4  FALLBACK         MEMORY_ADAPTER=local COMPUTE_ADAPTER=local
ACT 5  CLOSE            interfaces stable, OpenClaw untouched, MIT, repo URL
```

---

## Failure modes during the live demo

| If this happens | Do this |
|---|---|
| 0G Storage upload stalls in act 2 | Drop to `MEMORY_ADAPTER=local`, narrate: "for time, switching to local — same interface, same code path" |
| Compute call hangs in act 3 | Skip B2 entirely, lean on the test output from B1 |
| Wallet runs out of OG mid-demo | Use a pre-recorded session — `SESSION_ID=<one you saved earlier>` will resume from history without needing fresh writes |
| Audience asks "is the model really decentralized?" | Show the provider table in `.env.example` + the `verificationHash` returned per call |

The point of having validated the components individually before the demo is that any single failure during the demo is recoverable without re-doing setup.
