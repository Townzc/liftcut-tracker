<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Current priority (since 2026-10-13)

- The project goal is an engineering showcase product for users in mainland China:
  free, non-commercial, web-only. Product work now takes priority over new research.
- For product work, read `docs/product/2026-10-13-showcase-plan.md` and the current
  week's brief (`docs/product/WEEK1_CODEX_BRIEF.md` or its successor). Do not read
  the full research history unless the task touches `research/` or `docs/research/`.
- The rules in section 2 of the showcase plan are merge blockers: planned values are
  never actual values; unknown is `null`, never 0; the model never writes directly;
  every write is idempotent; undo is a compensating action; long-term plan changes
  go through the existing approval ledger (`src/services/agent/store.ts`).
- Out of scope unless the maintainer reopens them: multi-agent orchestration, nearby
  restaurant recommendations, app-store releases, monetization, a general long-term
  memory system, vector databases, new model training, new GPU experiments.
- Record each product PR in `docs/product/PRODUCT_LOG.md` (one entry, at most 15
  lines): why, what changed, what actually ran, limitations, next step.

## Research continuity

- Research results E1, I2 and I3 and their frozen sources are final; do not rerun or
  reinterpret them. P1-M (prepared in #63) is optional and does not block product
  milestones; run it only when the maintainer explicitly opens a GPU window.
- When working on research, read `docs/AGENT_RESEARCH_ROADMAP.md` and
  `docs/AGENT_RESEARCH_PROGRESS.md`. They are the technical plan and current handoff.
- If present locally, `docs/Agent-PostTraining-Career-Roadmap.md` contains private
  career context. Keep it local; do not add it to commits or quote its personal
  details in public issues, pull requests, or documentation.
- At the end of meaningful work, update progress with what actually ran, evidence,
  limitations, next steps, and any plan change with its reason. Planned metrics
  and historical reports must never be presented as newly verified results.
- Maintain `docs/research/EXPERIMENT_LOG.md` as the human-readable research journal.
  Each substantive increment must record what changed, why that choice was made,
  what actually ran and what its results mean, and the next step with its trigger.
  Link code/configs and raw evidence; separate observations, interpretations,
  limitations and pending work. Include a short learning checkpoint so the
  maintainer can explain the experiment independently. Never backfill predictions
  as if they were written before observing a result.
- Start substantial changes on a focused branch based on current `main`. Verify
  and commit there before merging into `main` and syncing GitHub, as authorized
  by the maintainer. Preserve unrelated branch work; do not force-push.
- Use synthetic, licensed fixtures for public research. Never commit credentials,
  real health records, generated private datasets, or model weights.
