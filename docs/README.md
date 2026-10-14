# LiftCut Documentation

| Document | Purpose |
| --- | --- |
| [Showcase Product Plan](./product/2026-10-13-showcase-plan.md) | Current priority since 2026-10-13: scope, rules, milestones, highlights and China compliance; start here for product work |
| [Week 1 Codex Brief](./product/WEEK1_CODEX_BRIEF.md) | Unknown values stay null and the feature-flagged today-session card; see hosted release for actual rollout |
| [Week 2 Codex Brief](./product/WEEK2_CODEX_BRIEF.md) | Next product increment: rules-only drafts, atomic sentence writes, receipts and compensating undo |
| [W2a Parser Verification](./product/W2A_VERIFICATION.md) | Authored 150-case rules evaluation, null and correction checks; parser-only increment before W2b, no model evaluation |
| [W2b Sentence Receipts](./product/W2B_VERIFICATION.md) | Live sentence preview, atomic batch saves, compensating undo, real Auth/production verification and synthetic fixture cleanup |
| [Week 3 Codex Brief](./product/WEEK3_CODEX_BRIEF.md) | Offline outbox first, then session-only exercise replacement; no GPU work |
| [W3a Offline Outbox](./product/W3A_VERIFICATION.md) | Account-bound IndexedDB queue, ordered retries, conflict review, actual database and browser verification |
| [Product Log](./product/PRODUCT_LOG.md) | One short entry per product PR |
| [W1b Verification](./product/W1B_VERIFICATION.md) | Today-session transactions, real PostgreSQL/RLS, browser recovery, evidence and rollout boundaries |
| [W1 Hosted Release](./product/W1_DEPLOYMENT.md) | Applied migrations, protected backup, real Auth/database verification, TLS, deployment and rollback |
| [Agent Research Roadmap](./AGENT_RESEARCH_ROADMAP.md) | Approved technical direction, milestones, experiments and revision rules |
| [Agent Research Progress](./AGENT_RESEARCH_PROGRESS.md) | Completed work, evidence, decisions and the next task; start here when resuming |
| [E1 Full-Task Results](./research/2026-10-13-e1-complete-results.md) | Real 48-pair evaluation, fixed D acceptance, no incremental win, resource sampling and confirmed closure |
| [Post-E1 Plan](./research/2026-10-13-post-e1-plan.md) | Application approval/revocation/idempotency first; conditional next model and performance experiments |
| [AgentLab Quickstart](../research/liftcut-agent/README.md) | Offline proposal benchmark, interactive tools, workflow and replay commands |
| [Interactive Environment Experiment](./research/2026-09-28-interactive-environment.md) | Approval and memory contracts, trace walkthrough, actual control results and limits |
| [Model-Policy Adapter](./research/2026-09-28-model-policy.md) | Function-call protocol, request budgets, raw response accounting and replay |
| [Hosted Development Baseline](./research/2026-09-28-development-baseline.md) | Full 14-case run, six retained failures, offline audit and deduplicated spending |
| [Protocol and Data Pipeline](./research/2026-09-28-protocol-and-data-pipeline.md) | Versioned tool protocols, four-arm experiment, verified decisions and real CPU loss-mask audit |
| [Small-Model GPU Pilot Plan](./research/2026-09-28-small-model-pilot-plan.md) | Proposed pinned model, 4090 configuration, four-hour limit, CNY 30 budget and shutdown procedure; unexecuted |
| [Historical Evaluation Audit](./research/2026-09-28-evaluation-audit.md) | Measurement limitations and evidence recovery checklist |
| [LiftCut-Coach Technical Report](./LiftCut-Coach-Technical-Report.md) | Architecture, structured-output pipeline, LoRA training, evaluation methodology, results, and limitations |
| [AI Coach Agent Blueprint](./AI_COACH_AGENT.md) | Proposed memory model, tool boundaries, safety rules, and phased delivery plan for a conversational coach |
| [Project Structure](./Project-Structure.md) | Guide to the application, data, services, research, and test directories |
| [Interview Q&A](./Interview-QA.md) | Engineering and research discussion questions covering the product, model training, and evaluation |
| [Server Runbook Example](./server-runbook.example.md) | Example operational notes for local model serving and deployment |

Start with the [repository README](../README.md) for the product overview, live demo, setup instructions, and current benchmark summary.
