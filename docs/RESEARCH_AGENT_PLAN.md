# Plan — Research Agent (`examples/research-agent/`)

> **Status:** plan, awaiting team approval before implementation.
> **Branch:** `feat/research-agent` (off `main`, parallel to `chore/demo-readiness`)
> **Author:** Juan
> **Audience:** Darien (review), ETHGlobal judges (downstream)

---

## 1. Why this matters for the framework track

The framework track ($7,500) judges whether 0G-Claw is a **reusable framework** or just a clever single-use agent. Today the repo has one example (`basic-agent`) that proves the adapters compose into a working chat loop. That's necessary but not sufficient — a framework is judged on whether **a second, structurally different agent** can be built on the same primitives without changing the framework itself.

This plan adds a **research-agent**: a topic-driven, tool-using, multi-step agent. It's deliberately different from `basic-agent` along three axes:

| Axis | basic-agent | research-agent |
|---|---|---|
| **Pattern** | Conversational chat loop | Plan → execute → synthesize pipeline |
| **External I/O** | None (just LLM) | Tool use (Wikipedia API) |
| **Memory shape** | Linear conversation history | Topic-scoped findings + audit log |

If we can ship both with **zero changes to the adapter layer**, that's the proof point: the framework supports many agent shapes, not one.

A secondary win: the research-agent is the strongest showcase of the **shared memory** capability. The "agent ID" is derived from the topic itself, so the same wallet running the same topic from any machine resumes the same research. That's a story no centralized agent framework can tell.

---

## 2. Concept

**One-line:** "Tell the research-agent a topic. It plans sub-questions, looks them up, summarizes findings, persists everything to 0G memory, and produces a structured report. Resumable from any machine with the same wallet."

**Example session:**

```bash
RESEARCH_TOPIC="0G Protocol architecture" pnpm example:research
```

Output:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  0G-Claw Research Agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Topic       : 0G Protocol architecture
  Topic ID    : research-7f3a2c19
  Memory      : 0g
  Compute     : 0g
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[plan] Generating sub-questions…
[plan] 4 sub-questions:
  1. What is the high-level architecture of 0G Protocol?
  2. How does 0G Storage differ from existing decentralized storage?
  3. What is 0G Compute and how does verifiable inference work?
  4. What is the 0G chain and its role in the stack?

[research] Q1/4: What is the high-level architecture…
  → Wikipedia: <excerpt>…
  → finding: <summary>
  → verificationHash: 0xabc… (0G TeeML proof)
  → persisted to KV + Log

[research] Q2/4: How does 0G Storage differ…
  …

[synthesis] Producing final report…
  → 5 paragraphs, 4 cited findings
  → verificationHash: 0xdef…

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Report — 0G Protocol architecture
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<5-paragraph synthesis with citations>

  4 findings persisted to 0G memory under research-7f3a2c19
  To resume / extend on any machine:
    RESEARCH_TOPIC="0G Protocol architecture" pnpm example:research
```

**Second run (same topic, same wallet, anywhere):**

```
[plan] Found 4 prior findings on this topic. Skipping re-research.
[synthesis] Producing report from cached findings…
```

This is the demo moment. The research is portable, not tied to one machine.

---

## 3. Scope

### In scope

- New directory `examples/research-agent/` with full implementation
- Tool abstraction **local to the example** (does not change framework)
- Wikipedia search tool (free, no auth)
- Memory recall tool (search prior findings within the active research)
- Structured prompts for plan / extract / synthesize phases
- Idempotent re-runs: same topic + same wallet = resumes cached research
- Integration with existing `IMemoryAdapter` and `IComputeAdapter` only — no new adapter interfaces
- Tests for the tools (vitest) — Wikipedia mocked, MemoryRecall against in-memory adapter
- README for the example
- Mention in root README's example list
- New `pnpm example:research` script in `package.json` (additive only)

### Out of scope (explicitly)

- Changes to `adapters/` — anything in that directory stays untouched
- Changes to `examples/basic-agent/`
- New dependencies in `package.json` — using built-in `fetch` and `crypto`
- A new `ITool` interface in the framework — see [§9 Future work](#9-future-work)
- Web search providers that need API keys (Tavily, Brave, Bing)
- Streaming responses
- ENS integration (separate track)
- Multi-language Wikipedia or Google Scholar (English Wikipedia only)

### Constraints honored from `CLAUDE.md`

- TypeScript strict, no `any` implicit
- Errors typed and handled, no empty catches
- Named exports
- One file per class
- No hardcoded endpoints / keys / wallets
- No mocks for adapter integration tests (we test tools, not adapters)
- Tests required for new code

---

## 4. Architecture

### 4.1 How it fits with existing framework

```
┌────────────────────────────────────────────────────────────┐
│                      research-agent                         │
│                                                             │
│   ┌──────────────────────────────────────────────────┐    │
│   │  Pipeline:                                       │    │
│   │   plan → research(loop) → synthesize             │    │
│   └─────────────────┬────────────────────────────────┘    │
│                     │                                       │
│        ┌────────────┼────────────┬────────────┐            │
│        ▼            ▼            ▼            ▼            │
│   ┌────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐      │
│   │  ITool │  │  Memory  │  │ Compute │  │ TopicID │      │
│   │(local) │  │ Adapter  │  │ Adapter │  │  hash   │      │
│   └────────┘  └──────────┘  └─────────┘  └─────────┘      │
│        │            │            │                          │
└────────┼────────────┼────────────┼──────────────────────────┘
         │            │            │
         ▼            ▼            ▼
   Wikipedia     0G Storage     0G Compute
   (or memory    KV + Log       (verifiable)
    recall)
```

The research-agent uses the framework as an opaque dependency. Memory and compute are injected through the same `IMemoryAdapter` / `IComputeAdapter` interfaces basic-agent uses. Tools are local to the example — they're not a framework concept (yet).

### 4.2 Memory schema

The agent uses a **derived agent ID** from the topic. Two pieces:

| Concept | Value | Purpose |
|---|---|---|
| `agentId` | `research-{sha256(topic)[:8]}` | Stable, deterministic — same topic on any machine maps to same key |
| `sessionId` | `findings` (constant) | One session per topic. Multiple runs append/update findings under the same session |

This means:

- Wallet A on machine X researches "0G Protocol" → writes to `research-7f3a2c19/findings`
- Wallet A on machine Y also queries "0G Protocol" → reads from `research-7f3a2c19/findings`, sees prior research, doesn't duplicate
- Wallet B (different wallet) gets a different namespace because 0G Storage scopes by signing wallet

That's **shared memory across machines** as a real feature, not just a slogan.

### 4.3 Data shapes

```typescript
// Stored in IMemoryAdapter.saveSession (mutable snapshot)
interface ResearchState {
  topic: string;
  topicId: string;
  subQuestions: string[];
  findings: Finding[];      // accumulated as we go
  reportMarkdown: string | null;  // null until synthesis
}

// Each finding is a SessionMessage with role="assistant" carrying JSON
interface Finding {
  index: number;
  question: string;
  source: string;             // "wikipedia" | "memory-recall"
  evidence: string;           // raw extract
  summary: string;            // LLM-summarized
  verificationHash: string | undefined;
  timestamp: number;
}

// Log Store (append-only) gets one entry per finding for replayability.
// SessionMessage shape is reused — content is JSON.stringify(Finding).
```

We map the existing `SessionMessage` / `AgentSession` types to this domain by encoding `Finding` as the JSON content of a `role: "assistant"` message. **No interface changes.**

### 4.4 Tool abstraction

```typescript
// examples/research-agent/tools/ITool.ts
export interface ToolResult {
  source: string;           // identifier for citations
  content: string;          // raw evidence
}

export interface ITool {
  name: string;
  description: string;
  run(input: string): Promise<ToolResult>;
}
```

This lives **inside the example**, not in `adapters/`. If we later decide tools should be a framework primitive, [§9](#9-future-work) covers the migration.

### 4.5 Pipeline

```
1. Boot
   - Read RESEARCH_TOPIC env var (required)
   - Compute topicId = sha256(topic).slice(0, 8)
   - agentId = `research-${topicId}`, sessionId = "findings"
   - Build memory + compute adapters via existing env-var dispatch

2. Resume check
   - Try memory.loadSession(agentId, sessionId)
   - If state.findings is non-empty: skip plan + research, jump to synthesis-or-print
   - Print "found N prior findings, will reuse"

3. Plan
   - LLM call with structured prompt:
     "Break this topic into 3-5 sub-questions. Output JSON: {questions: [...]}"
   - Parse + validate. On parse failure, retry once with stricter prompt
   - Persist subQuestions in session state

4. Research loop (per sub-question)
   - Call WikipediaSearchTool(question) → ToolResult
   - LLM call: "Extract 1-2 key facts from this excerpt relevant to: {question}"
   - Build Finding { question, source, evidence, summary, verificationHash }
   - memory.appendMessage(agentId, sessionId, JSON.stringify(finding))  ← Log
   - Update session.findings, memory.saveSession()                       ← KV
   - Print finding + verificationHash if present

5. Synthesis
   - LLM call: "Given these findings, write a 3-5 paragraph report. Cite findings by index."
   - Save reportMarkdown to session state
   - Print report

6. Done
   - Print resume command (same RESEARCH_TOPIC)
```

### 4.6 Failure handling

| Failure | Response |
|---|---|
| `RESEARCH_TOPIC` not set | Hard error with usage example |
| LLM returns malformed JSON in plan | Retry once with stricter prompt; if still fails, fall back to topic itself as a single question and continue |
| Wikipedia returns no hits | Tool returns `{source: "wikipedia", content: "(no results)"}`; finding is recorded with summary="(no relevant data found)" — does not block other sub-questions |
| Wikipedia 5xx / network error | Same as no hits — log warning, continue |
| Compute broker not funded | Surface the same error message basic-agent does ("set COMPUTE_ADAPTER=local…"); abort the run |
| Local stub compute | Works structurally but produces nonsense findings — print a warning at boot if `COMPUTE_ADAPTER` is local, recommend OpenAI/0G for real output |

---

## 5. Files to create / modify

### New

| Path | Purpose |
|---|---|
| `examples/research-agent/agent.ts` | Main entry, pipeline orchestration |
| `examples/research-agent/README.md` | Run modes, env vars, output explained |
| `examples/research-agent/lib/topicId.ts` | `topicIdFromString(topic: string): string` |
| `examples/research-agent/lib/researchTypes.ts` | `Finding`, `ResearchState` types |
| `examples/research-agent/lib/prompts.ts` | The 3 structured prompts (plan, extract, synthesize) |
| `examples/research-agent/tools/ITool.ts` | Tool interface (local to example) |
| `examples/research-agent/tools/WikipediaSearchTool.ts` | Wikipedia API tool |
| `examples/research-agent/tools/MemoryRecallTool.ts` | Search prior findings in current session |
| `examples/research-agent/tools/WikipediaSearchTool.test.ts` | Vitest tests with `fetch` mocked |
| `examples/research-agent/tools/MemoryRecallTool.test.ts` | Vitest tests against in-memory adapter |

### Modified (additive only)

| Path | Change |
|---|---|
| `package.json` | Add `"example:research": "tsx examples/research-agent/agent.ts"` and `"example:research:prod": "node dist/examples/research-agent/agent.js"`. **No new dependencies.** |
| `README.md` | Mention research-agent in the examples table; add a one-paragraph "two example agents" callout |
| `.env.example` | Add `RESEARCH_TOPIC=` line with comment |
| `docs/SUBMISSION.md` | Add research-agent to the deliverables list (will land if this branch merges before submission) |
| `docs/ARCHITECTURE.md` | Add a paragraph noting "two reference agents prove the framework supports multiple shapes" — only if `chore/demo-readiness` is merged first; otherwise skip |

### Untouched (forbidden)

`adapters/`, `openclaw/`, `examples/basic-agent/`, `scripts/`, `vitest.config.ts`, `tsconfig.json`, anything in the OpenClaw submodule.

---

## 6. Dependencies

**No new packages.** Built-in only:

- `fetch` (Node 18+) — for Wikipedia API
- `crypto` — for topic hashing (`createHash('sha256')`)
- `node:readline` — only if we add interactive mode (likely not; topic is env var)

Existing packages used:

- `dotenv` (already present) — load `.env`
- `vitest` (already present) — tests

This is a deliberate choice. Zero new install surface = zero supply-chain risk for judges + zero `pnpm install` surprises.

---

## 7. 0G-native capability mapping

Each capability shows up in code, not just slogans:

| Capability | Where in research-agent |
|---|---|
| **Verifiable inference** | Each finding's `verificationHash` is captured from `compute.chat()` and stored on the finding. Synthesis hash captured separately. Printed in console + included in stored state |
| **Shared memory across agents** | `agentId = "research-${sha256(topic)[:8]}"` makes the same topic deterministically map to the same memory namespace. Two agents on the same wallet querying the same topic share findings |
| **Replayable execution** | Each finding goes to the Log Store via `appendMessage`. The Log alone is sufficient to reconstruct the report — `loadHistory(agentId, sessionId)` returns every finding in order |
| **Portable agent identity** | Same wallet on any machine running the same `RESEARCH_TOPIC` = same research. Demonstrable in a 30-second clip |

If a judge asks "ok but is shared memory just a slogan?" — answer: hash a topic on machine A, wait for findings to land in 0G, run the same topic on machine B with the same wallet, watch it skip the research because findings are already there. That's the demo.

---

## 8. Validation plan

### 8.1 Static

- [ ] `tsc` passes (no implicit `any`, all interfaces satisfied)
- [ ] `vitest` passes for the new test files
- [ ] No diff in `adapters/`, `examples/basic-agent/`, or `scripts/` (verified by `git diff --stat`)

### 8.2 Tool tests (vitest, mocked)

- [ ] `WikipediaSearchTool.test.ts` — mocks `global.fetch`, asserts URL, asserts shape of `ToolResult` for happy path, no-results, network-error
- [ ] `MemoryRecallTool.test.ts` — uses `LocalMemoryAdapter` with a tmp dir, seeds it with findings, asserts the tool returns matches

### 8.3 End-to-end smoke

- [ ] `RESEARCH_TOPIC="test" pnpm example:research` runs to completion with `MEMORY_ADAPTER=local COMPUTE_ADAPTER=local`. The output will be nonsense (local stub) but the pipeline must complete without errors
- [ ] `RESEARCH_TOPIC="test" pnpm example:research` second run reads from prior session and skips research

### 8.4 Live (optional, requires creds)

- [ ] `RESEARCH_TOPIC="0G Protocol" MEMORY_ADAPTER=0g COMPUTE_ADAPTER=0g pnpm example:research` produces a real report with non-undefined `verificationHash` per finding

### 8.5 Demo proof clip

A 60-second screen recording for the submission video showing:
1. First run — plans 4 questions, runs Wikipedia, synthesizes, prints findings + hashes
2. Kill it, run from a different shell with same env — "found 4 prior findings, skipping research, printing cached report"

---

## 9. Future work (post-MVP)

These are out of scope for this branch but documented so we don't lose them:

| Item | Why not now | When |
|---|---|---|
| Promote `ITool` to framework primitive (`adapters/tools/`) | Touches `adapters/`, requires Darien sign-off | Post-submission, or as a Darien-led PR |
| Additional tools (file-read, URL-fetch, GitHub search) | Each adds surface area; one tool is enough to prove the abstraction | If a specific judge demo asks for it |
| Streaming synthesis | Requires `chatStream` on `IComputeAdapter` — interface change | Post-submission |
| Topic continuation ("extend prior research with new sub-questions") | Adds one more pipeline branch; nice-to-have | If time permits before deadline |
| ENS-published research reports | ENS track work, separate branch | ENS track effort |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM returns badly-formatted JSON for plan/extract/synthesis | Medium | Pipeline aborts mid-run | Strict prompt + one retry + textual fallback. Tests pin the parser |
| Wikipedia API rate limits during demo | Low | One sub-question fails | Each finding is independent; pipeline continues. Cache hit on second run |
| Local compute stub produces nonsense report | Always (by design) | Confuses reviewers | Boot-time warning when `COMPUTE_ADAPTER=local`; README is loud about it |
| Galileo Storage slow during persistence | Medium | Findings take seconds each | Same trade-off as basic-agent — the Demo Script already accounts for this |
| Topic hashing collision | Negligible | Two topics map to same agentId | sha256 truncated to 8 hex chars = 4B possibilities. Acceptable for the demo |
| Reviewer asks "why not LangChain tools?" | High | Architectural question | Prepared answer: ITool is local because we deliberately chose not to grow the framework surface for one example. The framework's job is memory + compute. Tool patterns are application concerns |

---

## 11. Estimate

| Phase | Effort |
|---|---|
| Tool implementations + tests | ~2h |
| Pipeline orchestration in `agent.ts` | ~2h |
| Prompts + parser + retry logic | ~1h |
| README + env.example + script | ~30min |
| Smoke test + iteration | ~1h |
| **Total** | **~6.5h** |

This fits in one focused session. No blocking dependencies on Darien's work.

---

## 12. Open questions for Darien

Before I start coding, would like a yes/no on each:

1. **Branch base** — `feat/research-agent` from `main`, parallel to `chore/demo-readiness`. OK?
2. **Tool location** — tools live inside `examples/research-agent/tools/`, **not** in `adapters/`. OK to keep them out of the framework for this PR?
3. **Wikipedia as the only tool** — sufficient, or do you want a second tool (memory recall already planned, but anything else)?
4. **`package.json` scripts** — adding `example:research` and `example:research:prod`. OK with these touches to a "core" file?
5. **Docs updates** — should I update `docs/SUBMISSION.md` and `docs/ARCHITECTURE.md` in this PR (those files only exist on `chore/demo-readiness`)? My suggestion: skip in this branch, do them after both branches are merged.

Default if no objection: yes to all, doc updates skipped per #5.
