# Historical LiftCut-Coach evaluation audit

Audit date: 2026-09-28. Inspected base: `6603809` on `main`.
Method: source and checked-in artifact review; no provider calls or historical
training reruns. Historical results remain **reported, not reproduced here**.

| Finding | Source | Consequence / follow-up |
| --- | --- | --- |
| The table compares hosted models with a LoRA model, without the same unadapted base | [technical report](../LiftCut-Coach-Technical-Report.md), sections 6 and 9 | Add a same-base comparison before attributing gains to fine-tuning |
| Final schema is measured after normalization | [evaluator](../../research/liftcut-coach/scripts/eval_ai_provider.ts), final schema stage | Separately score raw strict validity and post-repair validity |
| Training checks enforce an upper bound on days, nonempty exercises and duration with a 15-minute tolerance | Evaluator `checkTrainingConstraints` | Not exact requested-day satisfaction; no comprehensive equipment, preference or semantic verification |
| Nutrition checks use broad calorie/protein ranges and nonempty collections | Evaluator `checkNutritionConstraints` | Not personalized nutritional quality, ingredient restriction satisfaction or numerical consistency |
| Samples are shuffled with a fixed seed, without source-family grouping | [splitter](../../research/liftcut-coach/scripts/split_dataset.ts) | Reproducibility does not establish absence of near-duplicate leakage |
| No validation-loss curve is recorded for the reported run | Technical report section 6.4 | Schema success cannot exclude overfitting; record validation loss and checkpoint selection |
| The tracked evaluation JSONL contains 2 examples; the report describes 293 evaluated cases | [example file](../../research/liftcut-coach/data/eval_cases.jsonl) | Recover the complete test manifest, hashes, run configurations and per-case outputs |
| `normalizedSchemaPass` counts successful normalization, not a separate schema parse | Evaluator normalization stage | Rename or precisely define this metric before comparing it with schema pass rates |
| Per-case result records do not retain complete successful responses | Evaluator `CaseResult` | Current summaries alone cannot support complete retrospective semantic rescoring |

## Recovery checklist

- [ ] Recover the 2,341/293/293 train/validation/test artifacts and identify hashes.
- [ ] Recover model/base revisions, tokenizer/chat template, adapter, training
  configuration, environment and logs, without publishing private data or weights.
- [ ] Recover full provider output and configuration for each claimed comparison.
- [ ] Recompute reported metrics under their original definitions.
- [ ] Add a paired unadapted-base run with the same prompting and decoding budget.
- [ ] Audit raw-output vs deterministic-normalization contributions.
- [ ] Build grouped, independently authored evaluation tasks before new training.

If original artifacts are unavailable, retain the numbers as historical reports
and start a separately versioned experiment. Do not invent missing evidence or
silently relabel the 2 example rows as the original benchmark.

This audit motivates the new AgentLab evaluator; it does not retroactively change
historical measured values or establish that any specific training example leaked.
