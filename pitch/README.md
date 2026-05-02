# pitch/

Public-facing landing for the 0G-Claw ETHGlobal Open Agents submission. This is the page judges and visitors see — it sells the project, embeds the demo video, and gives a copy-paste quickstart.

```bash
# View locally — no server needed, just open the file
xdg-open pitch/index.html
# or
firefox pitch/index.html
```

For a slightly more faithful preview (proper relative paths + no `file://` quirks):

```bash
cd 0G-CLAW
python3 -m http.server 8080
# then visit http://localhost:8080/pitch/
```

## What's on the page

- **Hero** with a live terminal mockup of a research-agent run (real `verificationHash` shape)
- **Problem / Solution** — concrete before/after vs OpenClaw today
- **How it works** — adapter contracts diagram (inline SVG)
- **Capabilities** — four 0G-native properties with code snippets
- **Reference agents** — basic-agent vs research-agent, side-by-side, same adapters
- **Demo video** — embed area for the < 3-min submission video
- **Try it** — four-step copy-paste quickstart
- **Stack** — 0G Storage SDK, serving broker, ENS, OpenClaw
- **Tracks** — Best Agent Framework + ENS AI Agents

The internal planning + roadmap page lives in [`/team-plan`](../team-plan/index.html) — that's not the submission landing.

## Hosting options

The page is a single HTML file with no build step.

- **Local**: open the file directly or run `python3 -m http.server` in the repo root
- **Vercel / Netlify**: point at `pitch/` as the build output, no build command needed
- **GitHub Pages**: enable Pages on `main`, set source to `/` (root); the URL becomes `https://<user>.github.io/0G-CLAW/pitch/`

The page loads Inter + JetBrains Mono from the Google Fonts CDN at view time. System sans-serif kicks in as fallback if offline.

## Updating the demo video

When the demo video is recorded, replace the placeholder `<div class="video-frame">` in `index.html` with an `<iframe>` pointing at YouTube / Loom / Vimeo. Keep the 16:9 aspect ratio and the cyan accent treatment — they match the rest of the page.
