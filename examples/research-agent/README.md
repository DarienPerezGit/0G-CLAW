# research-agent

Topic-driven, tool-using research agent built on the 0G-Claw framework. Different in shape from `basic-agent` (chat loop) — this is a structured pipeline:

```
plan → research(loop) → synthesize
```

The point of this example is to **prove that the framework supports more than one agent shape**. Same `IMemoryAdapter`, same `IComputeAdapter`, completely different agent.

---

## What it does

Given a research topic, the agent:

1. **Plans** — asks the LLM to break the topic into 3-5 focused sub-questions
2. **Researches** — for each sub-question, queries Wikipedia (free, no auth), then asks the LLM to extract relevant facts
3. **Persists** — every finding is written to both KV (latest snapshot) and Log (append-only audit trail)
4. **Synthesizes** — asks the LLM to write a concise, citation-grounded report
5. **Resumable** — re-running with the same topic + same wallet skips research and reprints the cached report

---

## 0G-native capabilities, made concrete

| Capability | How research-agent demonstrates it |
|---|---|
| **Verifiable inference** | Each LLM call's `verificationHash` (TeeML proof) is captured per finding and during synthesis. Printed in the console, persisted to memory |
| **Shared memory across agents** | `agentId = "research-${sha256(topic)[:8]}"` makes the same topic on any machine, with the same wallet, map to the same memory namespace. Two agents researching "0G Protocol" see and reuse each other's findings |
| **Replayable execution** | Every finding goes to the Log Store via `appendMessage`. The full report can be reconstructed from the log alone — `loadHistory(agentId, sessionId)` returns each finding in order |
| **Portable agent identity** | Same wallet, any machine, same `RESEARCH_TOPIC` = same research. No state on the local disk |

---

## Run modes

| Mode | Memory | Compute | When to use |
|---|---|---|---|
| `RESEARCH_TOPIC="..." pnpm example:research` | local filesystem | local stub (echo) | Smoke test the pipeline; **report will be nonsense because the local compute is a stub** |
| `RESEARCH_TOPIC="..." COMPUTE_ADAPTER=0g pnpm example:research` | local filesystem | 0G Compute | Real research, single machine |
| `RESEARCH_TOPIC="..." MEMORY_ADAPTER=0g COMPUTE_ADAPTER=0g pnpm example:research` | 0G Storage | 0G Compute | **Demo mode** — full decentralized stack, portable across machines |
| `RESEARCH_TOPIC="..." pnpm example:research:inspect` | (any) | none | **Read-only viewer** — print cached findings, hashes, and report without re-running the pipeline (see [Inspect mode](#inspect-mode)) |

> **Important:** with `COMPUTE_ADAPTER=local`, the agent prints a warning at boot. The local compute adapter is an echo stub — it exists for structural smoke tests, not for actual reasoning. For meaningful output, use 0G Compute.

---

## Environment variables

Same dispatch pattern as basic-agent, plus one required variable:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RESEARCH_TOPIC` | **yes** | — | The topic to research. Used to derive a stable `agentId` |
| `MEMORY_ADAPTER` | no | `local` | `local` or `0g` |
| `COMPUTE_ADAPTER` | no | `local` | `local` or `0g` |
| `OG_STORAGE_RPC` | only with `MEMORY_ADAPTER=0g` or `COMPUTE_ADAPTER=0g` | from `.env` | EVM RPC for the 0G chain |
| `OG_STORAGE_INDEXER` | only with `MEMORY_ADAPTER=0g` | from `.env` | 0G Storage indexer endpoint |
| `OG_PRIVATE_KEY` | with either 0G adapter | from `.env` | Wallet for storage / broker txs |
| `OG_COMPUTE_PROVIDER` | only with `COMPUTE_ADAPTER=0g` | from `.env` | Acknowledged 0G Compute provider address |

---

## Output shape

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  0G-Claw Research Agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Topic       : 0G Protocol architecture
  Topic ID    : 7f3a2c19
  Agent ID    : research-7f3a2c19
  Memory      : 0g
  Compute     : 0g

[plan] Generating sub-questions...
[plan] 4 sub-question(s):
  1. What is the high-level architecture of 0G Protocol?
  2. ...

[research] Q1/4: What is the high-level architecture...
  → source: wikipedia:0G_Network
  → summary: 0G Network is a decentralized AI infrastructure...
  → verificationHash: 0xabc... (0G TeeML proof)

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Report — 0G Protocol architecture
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<5-paragraph synthesis with [1], [2] citations>

  4 finding(s) persisted under research-7f3a2c19/findings
  Memory backend: 0G Storage (decentralized)

  To resume / reprint this report on any machine with the same wallet:
    RESEARCH_TOPIC="0G Protocol architecture" MEMORY_ADAPTER=0g pnpm example:research
```

---

## Inspect mode

`inspect.ts` is a read-only companion that loads a topic's cached research and prints findings, verification hashes, and the report — **without invoking compute or any tools**. It's the most direct demonstration of "shared memory across agents": the inspecting process never participates in the research, it only queries memory.

```bash
RESEARCH_TOPIC="0G Protocol architecture" pnpm example:research:inspect
RESEARCH_TOPIC="..." MEMORY_ADAPTER=0g pnpm example:research:inspect
```

Output:

```
Summary
-------
  Sub-questions planned : 4
  Findings (KV snapshot): 4
  Findings (Log Store)  : 4
  Report cached         : yes
  Synthesis verified    : yes (0xabc123…)

Findings
--------
  [1] What is the high-level architecture of 0G Protocol?
        source : wikipedia:0G_Network
        summary: 0G Network is a decentralized AI infrastructure protocol...
        hash   : 0xabcdef… (TeeML proof from acknowledged provider)
        time   : 2026-04-30T16:21:30.123Z

  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Report — 0G Protocol architecture
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<5-paragraph synthesis with [1], [2] citations>
```

Demo idea: run the agent on machine A, then run inspect on machine B. Same wallet, same topic — B sees everything A produced, including every per-finding `verificationHash`, without re-doing any work.

If the snapshot and log are out of sync (durability scenario from §13 of the plan doc), inspect prints a warning indicating the next agent run will recover from the log.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│              examples/research-agent/                   │
│                                                         │
│   agent.ts                                              │
│      │                                                  │
│      ├── lib/topicId.ts        (sha256 topic → id)      │
│      ├── lib/prompts.ts        (plan/extract/synthesize)│
│      ├── lib/researchTypes.ts  (Finding, ResearchState) │
│      └── tools/                                         │
│           ├── ITool.ts                                  │
│           ├── WikipediaSearchTool.ts  (used)            │
│           └── MemoryRecallTool.ts     (available)       │
│                                                         │
│   uses (via interfaces, not implementations):          │
│      IMemoryAdapter   IComputeAdapter                   │
└────────────────────────────────────────────────────────┘
```

Tools live **inside the example**, not in `adapters/`. They are intentionally not a framework primitive — the framework's surface is still memory + compute. `MemoryRecallTool` is exported but not used in the main pipeline; it's a building block for future incremental-research workflows (e.g. extending a topic with new sub-questions).

If `ITool` should be promoted to a framework-level concept later, the migration is straightforward: this file becomes the canonical interface and `adapters/tools/` re-exports it.

---

## Memory layout

| Slot | Storage | Contents |
|---|---|---|
| `session:research-{topicId}:findings` (KV) | mutable snapshot of `ResearchState` | quick resume; one `system` message holds `JSON.stringify(state)` |
| `log:research-{topicId}:findings` (Log) | append-only `assistant` messages | each one's `content` is `JSON.stringify(Finding)` — sufficient to rebuild the entire research from scratch |

This dual-write pattern is why **replayable execution** is real: even if the KV snapshot is lost or corrupted, the Log Store has every finding in chronological order.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `RESEARCH_TOPIC env var is required` | Forgot to set the topic | `RESEARCH_TOPIC="your topic" pnpm example:research` |
| `compute error: broker not funded or not initialized` | Wallet has no broker ledger | `pnpm setup:broker` (one-time per wallet) |
| `[plan] Could not parse plan output — falling back to topic itself` | LLM returned malformed JSON twice in a row | Falls back to using the topic as the only sub-question; pipeline continues |
| `(no results)` from Wikipedia | Sub-question phrasing didn't match any article | Pipeline continues with empty evidence; the LLM extractor will say "(no relevant data)" |
| Galileo Storage upload stalls | Network issues on testnet | Retry, or switch to `MEMORY_ADAPTER=local` for the demo |

---

## Running the tests

```bash
pnpm test examples/research-agent
```

Tests cover:

- `topicId.ts` — determinism, normalization, rejection of empty input
- `WikipediaSearchTool.ts` — happy path (mocked fetch), no-results, network error, HTTP error, missing extract, empty input
- `MemoryRecallTool.ts` — match by question / summary / evidence, no-match, ignores non-JSON / non-assistant messages, empty input

Tests use `LocalMemoryAdapter` against a `mkdtemp` directory — no testnet credentials required.

---

## Why this matters for the framework track

Two example agents on the same adapter layer prove the framework supports many shapes, not one. A judge can ask: "ok cool, but is this just a clever chat agent?" — the answer is "no, here's a research pipeline using the same primitives, no framework changes needed."

That's the proof point for the [Best Agent Framework, Tooling & Core Extensions](https://ethglobal.com/events/openagents) track.
