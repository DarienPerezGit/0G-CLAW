# pitch/

Self-contained planning + showcase page for the 0G-Claw ETHGlobal Open Agents submission.

```bash
# View locally — no server needed, just open the file
xdg-open pitch/index.html
# or
firefox pitch/index.html
```

To host on GitHub Pages once merged to `main`, set the Pages source to `/` (root) and the URL becomes `https://<user>.github.io/0G-CLAW/pitch/`.

The page contains:

- **Status snapshot** of what works today (mirrors the README's status table)
- **Architecture diagram** (inline SVG)
- **Winner-mode roadmap** — 4 tiers, each item with a persistent checkbox (localStorage)
- **Day-by-day schedule** to the deadline
- **Demo strategy** summary (full version in `docs/DEMO_SCRIPT.md`)
- **Submission checklist** with progress bar
- **Shipping log** of the work already done across both feature branches

Single HTML file. No build step, no install, no local server. The page loads Inter + JetBrains Mono from the Google Fonts CDN at view time, so a network connection is required for the typography to render correctly (system sans-serif kicks in as fallback if offline).
