<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Research continuity

- Before project work, read `docs/AGENT_RESEARCH_ROADMAP.md` and
  `docs/AGENT_RESEARCH_PROGRESS.md`. They are the technical plan and current handoff.
- If present locally, `docs/Agent-PostTraining-Career-Roadmap.md` contains private
  career context. Keep it local; do not add it to commits or quote its personal
  details in public issues, pull requests, or documentation.
- Prioritize verifiable Agent tasks, evaluation, data quality, and post-training.
  Keep product work tied to these milestones or necessary maintenance.
- At the end of meaningful work, update progress with what actually ran, evidence,
  limitations, next steps, and any plan change with its reason. Planned metrics
  and historical reports must never be presented as newly verified results.
- Start substantial changes on a focused branch based on current `main`. Verify
  and commit there before merging into `main` and syncing GitHub, as authorized
  by the maintainer. Preserve unrelated branch work; do not force-push.
- Use synthetic, licensed fixtures for public research. Never commit credentials,
  real health records, generated private datasets, or model weights.
