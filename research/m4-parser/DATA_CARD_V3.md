# M4 v3 development data preparation

This is data preparation, **not a trained candidate or a new independent test**.
The v2 experiment and its failed quality gates remain unchanged. The short v2
system prompt is retained; the unsuccessful long-prompt diagnostic is not adopted.

The [generator](scripts/build-v3.ts) keeps the original 4,000 training rows and
replaces the v2 augmentation with 1,200 new label-first positive/negative pairs:
**6,400 training rows**. Training now varies load/reps order, puts plan/negation/
uncertainty/question qualifiers both before and after the report, and includes
40 explicit weight-correction pairs whose negative version omits the unit.
Bodyweight remains null load/unit, unstated RPE remains null, and multi-set RPE
has an explicit last/every-set scope. There are no model-authored labels.

Development is **740 rows**: the already observed original 500 test rows,
explicitly repurposed as development only, plus 120 new pairs using a separate
sentence frame. This is allowed evaluation reuse, never training reuse. The
original files/manifests/scores are untouched. Neither old handwritten cases nor
any historical evaluation sentence enters training. This revision creates no
new `test` file; a future independent acceptance set must have separate provenance.

Template pools are assigned before sampling. Training and development have
**zero template-ID overlap and zero normalized-text overlap**; their semantic
concepts, qualifier phrases and label generator are shared. This checks
compositional transfer, not independent human language. Changing numeric values
does not make an observed template an unseen evaluation design.

The [manifest](data/v3-manifest.json) records all file hashes, templates, intents
and language counts. All six intents occur in both splits. Model input contains
only exercise names and the sentence; selected exercise, saved sets and plan
targets are absent. SFT targets exactly match labels; `dev-eval.jsonl` has no answers.
The model must start from the original base in any future candidate run; prior
candidate weights and their development exposure are not a new blind baseline.

Actual CPU verification: four data regressions and the full 200-test root suite
passed; TypeScript passed. The saved real tokenizer gives maxima **296 train /
295 dev tokens**, including targets/end marker, with no truncation at 512. Eval
input max is 179. [Token audit](results/data-v3-20261021/token-audit.json).

The existing SFT path actually ran two optimizer steps with eight representative
train/dev rows, batch 1, activation checkpointing and CPU; training/dev metric
time 26.2 seconds, export progress 29.7 seconds. Adapter values are finite, LoRA B
updated, and the merged model restores `use_cache=true`. The final generator
produces byte-identical smoke inputs. This smoke reused the **saved v1 merged
model**, not the original base, and is not a quality measurement or GPU timing.
[Metrics, versions and hashes](results/data-v3-20261021/cpu-smoke.json).

Generate with `node --import tsx research/m4-parser/scripts/build-v3.ts`; append
`--check` to verify the committed manifest. Generated rows and model weights stay
outside Git. Before GPU: freeze a bounded candidate protocol, evaluation design,
source/weight hashes and all CI checks. Data preparation alone does not authorize
or launch training. Native integration and physical-device validation remain pending.
