# V6 training policy and catalog comparison

The v5 diagnosis found 40 synthetic training targets that called registered
`卧推` / `bench press` aliases unknown, contradicting the shared exercise
registry. V6 resolves those aliases to the available barbell-bench entry. A full
`哑铃卧推` / `Dumbbell bench press` mention still wins over its shorter embedded
alias. Unregistered, unavailable or multiply matched identities are not guessed.
The product registry, application writes and all frozen v1–v5 files stay unchanged.

[The builder](../scripts/build-v6.ts) first creates a corrected control T:
exactly 40 labels use the existing paired positive's explicit fields and the
registered alias target. The other 6,360 labels and **all 6,400 sentence bytes**
remain unchanged. The correction ledger is in [the manifest](../data/v6-manifest.json).
Those 40 items become positive records in both arms; this common correction is
separate from the catalog intervention and is not evidence of improved accuracy.

Candidate S changes only model-visible catalog membership/order. Its pool comes
exclusively from the original training catalogs. It retains each explicit target
and every existing mentioned identity, excludes unavailable mentioned identities,
keeps the same list size and distinct identities, and shuffles using seed
2026102206. Of 6,400 catalogs, 6,397 change. Labels, sentences, order and training
system prompt match T. Non-visible selection metadata is cleared if its old name
is removed; it never enters the SFT input. No plan or numeric default is added.

The pair comparison tests a catalog augmentation package (membership **and**
order), not either factor alone. It does not assume that catalog coverage caused
v5's failures or will solve missing units/RPE scope. Both arms retain the existing
positive/negative boundary examples; the next runner must report strict reasons,
useful positives, action binding and fields separately with unchanged safety gates.

[CPU policy checks](../src/training-policy-v6.ts) reject known aliases labeled
unknown, wrong action bindings, duplicated identities, weights unbound to their
stated unit, wrong boundary reasons, invented RPE scope and refusal of positives.
The checks use the shared registry and a bounded audit of the synthetic grammar;
they are not a general natural-language parser or permission to write a record.
[Mutation tests](../../../tests/m4-v6-policy.test.ts) deliberately corrupt these
properties and verify rejection, including a numeric role swap.

Rebuild and verify with:

```sh
node --import tsx research/m4-parser/scripts/build-v6.ts
node --import tsx research/m4-parser/scripts/build-v6.ts --check
node --test --import tsx tests/m4-v6-policy.test.ts
```

Private originals, paraphrases, numeric variants and outputs never feed this
builder. Exact sentence preservation provides provenance stronger than a simple
keyword exclusion check. Existing dev/challenge/handwritten material is unchanged
and remains observed diagnostic data, not newly independent acceptance.
This data preparation alone does not authorize a GPU opening or native release.
