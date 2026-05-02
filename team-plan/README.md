# team-plan/

> **Internal page — for the 0G-Claw team.** Not the ETHGlobal submission landing.
> The public-facing landing lives in [`pitch/`](../pitch/index.html).

Self-contained planning + tracking page used by Juan and Darien during the hackathon to coordinate work, track progress, and review the demo plan.

```bash
# View locally — no server needed, just open the file
xdg-open team-plan/index.html
# or
firefox team-plan/index.html
```

The page contains:

- **Status snapshot** of what works today
- **Architecture diagram** (inline SVG, same one used in the public landing)
- **Winner-mode roadmap** — 4 tiers, each item with a persistent checkbox (localStorage)
- **Day-by-day schedule** to the deadline
- **Demo strategy** summary (full version in [`docs/DEMO_SCRIPT.md`](../docs/DEMO_SCRIPT.md))
- **Submission checklist** with progress bar
- **Shipping log** of the work already done across the feature branches

Single HTML file. No build step, no install, no local server. Loads Inter + JetBrains Mono from the Google Fonts CDN at view time (system sans-serif fallback if offline).
