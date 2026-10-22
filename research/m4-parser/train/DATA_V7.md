# V7: align the training and inference contract

V6 T is the control: repaired alias labels, original catalogs, token-mean loss.
Its training system omits the ten legal clarification reasons, while inference
uses the existing v4 enumeration. V7 tests this mismatch as a hypothesis; v6
does not establish it as the cause of action, missing-unit or RPE-scope failures.

The [builder](../scripts/build-v7.ts) reuses all 6,400 v6 T sentences, labels,
catalogs and row order exactly. S changes only the system message to the frozen
inference enumeration. Dev uses that same system for loss measurement; its gold
and user inputs stay unchanged. Dev loss is not a model-selection criterion and
is not directly comparable with T's differently prompted dev loss. Training
parameters, original-base initialization, decoding and evaluation inputs stay
fixed. V6 S's catalog augmentation and v5's loss change are not combined here.

No new training examples are created. The 20 private originals, paraphrases,
numeric variants, outputs and all derivatives remain excluded. The versioned
builder takes no caller-supplied examples; pre-existing evaluation files pass
through without entering S training. Exact sentence, target and catalog sequence
checks enforce the intervention. This is provenance protection, not a claim that
a string-overlap detector can prove semantic non-contamination.

The [CPU auditor](audit_v7_inputs.py) checks roles, the two-field user allowlist,
paired bytes, system strings, complete token IDs, answer masks and no truncation.
It uses the actual pinned tokenizer; inference receives no assistant answer.
Runner, historical-control provenance, storage, restore and all-CI readiness
are separate follow-up gates. This data preparation does not authorize a GPU
opening or enable native inference. UI and confirmation/write paths are unchanged.

## Primary sources and their limited application

Sources checked on 2026-10-22. These motivate engineering checks, not a predicted
effect size or evidence that another company's results transfer to this model.

- [OpenAI fine-tuning best practices](https://developers.openai.com/api/docs/guides/fine-tuning-best-practices#crafting-prompts-for-training-data)
  recommends including effective instructions in training examples. We test the
  already deployed enumeration, with no new task examples or prompt search.
- [Google Gemma prompt formatting](https://ai.google.dev/gemma/docs/core/prompt-structure)
  explains the role/turn format used during both training and inference. We keep
  Qwen's own pinned template and verify its tokens; Gemma's tokens are not copied.
- [Anthropic, Building effective agents, Appendix 2](https://www.anthropic.com/research/building-effective-agents)
  treats tool definitions as part of prompt engineering and notes that output
  representations differ in model difficulty. We keep the closed action/reason
  contract and test semantics as well as valid JSON; no new agent framework.
- [Meta, The Llama 3 Herd of Models, §§5.1.4, 5.2 and 5.3](https://arxiv.org/html/2407.21783v3)
  reports contamination analyses, post-training decontamination and separation
  of human-evaluation prompts from modeling teams. Our repeatedly observed
  development sets stay labeled development; private continuous acceptance
  remains separate and cannot supply training material.

Model acceptance still requires the original exactness, schema, unsupported-field,
useful-positive, strict-reason, grounding and quantization gates. A development
pass alone cannot enable the model: continuous and physical-device acceptance
remain necessary. RPE scope means which sets an RPE applies to, not its value range.
