# Protocol revision and verified development data pipeline

This increment implements the protocol experiment and connects saved rollouts to
model-specific tokenization. **The four-arm paid comparison has not run.** Its
launch was rejected by the execution environment before process creation, including
after explicit budget confirmation. The rejection supplied only `blocked by policy`.
No new paid requests or server rental occurred. The last measured hosted result
remains **8/14**, and the recorded live-spending estimate remains **$0.0486840**.

## Versioned protocol and comparison

`ProtocolConfig` introduces two independent factors while keeping legacy
`ModelConfig`, prompt hashes and historical replay compatible:

- `tool_protocol`: `single` or `read_batch`.
- `prompt_revision`: `original` or `pending_approval_v1`.

The new strict/original control sends the same wire payload as the old policy.
Batch acceptance changes only the parser/runtime: the original single-call
instruction is retained in all four arms. The clarified prompt appends the
pending-approval outcome mapping. The environment, scorer and 24-step limit are
unchanged. See the committed [experiment plan](2026-09-28-protocol-comparison-plan.md).

A read batch contains at most four calls from `get_context`, `get_memories`,
`search_exercises`, and `validate_plan`. IDs, JSON and outer argument contracts
are checked for every member before any member executes. Semantic validation
feedback still comes from the tools. Calls execute in returned order and each
consumes a step. Every response retains its matching call ID. All tool replies
precede any buffered external user event and the next model request.

Reject mixed write/clarification/finish batches, unknown tools in batches,
duplicate/reused IDs, malformed JSON, extra outer arguments and batches exceeding
remaining steps. A valid single call still reaches the environment's authorization
checks. No argument repair, first-call selection, new approval or free tool step
is introduced. Raw response records now retain all decoded batch actions.

```sh
# No credentials or network calls:
python research/liftcut-agent/protocol_experiment.py preflight
python research/liftcut-agent/protocol_experiment.py mock --output-dir research/liftcut-agent/outputs/protocol-smoke
python research/liftcut-agent/compare_protocols.py --run-root research/liftcut-agent/outputs/protocol-smoke
```

Executed mock result: **14/14 for each of four profiles**, 97 synthetic responses
and 97 tool steps per profile. These workflow mocks emit single calls and therefore
have zero accepted batches; separate batch tests exercise actual multi-call
responses, approval, replay, timeout visibility and step exhaustion. Neither
measurement is LLM performance. The comparison tool audits every arm, requires
matching source/configuration except the two factors, and reports all four paired
contrasts. It refuses missing cells rather than reusing historical scores.

The prepared live command below requires an already configured
`LIFTCUT_AGENT_API_KEY` environment variable and a clean checkout. The tool never
loads credential files. It is documented for a permitted execution environment;
it was **not executed successfully** in this increment.

```sh
python research/liftcut-agent/protocol_experiment.py live --allow-live --base-url https://api.deepseek.com/v1 --max-reserved-usd 2.40 --output-dir research/liftcut-agent/outputs/protocol-live
```

Each arm has a $0.60 reservation guard. A known task failure does not cause a retry;
unknown usage stops subsequent arms. Source changes between arms stop the run.
Output directories are exclusive. This is a reservation estimate, not a provider
billing cap. Authorization is already recorded locally; a repeated authorization
request does not solve the execution-policy rejection.

## Replay-verified decision export

```mermaid
flowchart LR
  A[Saved raw replies and traces] --> B[Full replay and report audit]
  B --> C[Successful episodes]
  C --> D[Exclude known-invalid targets]
  D --> E[Decision prefixes with lineage]
  E --> F[Pinned tokenizer and mask audit]
  F --> G[Future reviewed SFT dataset]
```

`export_trajectories.py` requires a fully audited run and development-only source
scenarios. Failed episodes never become positive demonstrations. Within a
successful recovery episode, known-invalid candidate/tool decisions remain in
later history but are excluded from positive targets. Injected timeouts are not
treated as incorrect policy decisions. An assistant batch is an indivisible
target; any rejected member excludes that target.

Each row has scenario/family/persona IDs, source run/episode/call identity, response
digest, tool schemas, original observation history and exactly one final assistant
target. Function argument strings become JSON objects for chat-template input;
raw source artifacts remain unchanged. A recovery test confirms that a rejected
candidate is present as context for repair but never as a positive target.

Actual export from the original 8/14 hosted run:

| Measurement | Result |
| --- | --- |
| Source episodes | 14 |
| Included successful episodes / families | 8 / 8 |
| Excluded failed episodes | 6 |
| Decision rows | 59 |
| Included episodes with injected-timeout recovery | 007 and 008 |
| Known-invalid decisions inside included episodes | 0 |

The [published decisions and manifest](../../research/liftcut-agent/reports/development-decisions-2026-09-28/)
are pipeline smoke data. Outcome filtering is not independent human annotation,
and these public dev cases cannot establish unseen generalization. No train/test
split or training-ready corpus is claimed.

```sh
python research/liftcut-agent/export_trajectories.py --run-dir research/liftcut-agent/reports/deepseek-development-2026-09-28 --output-dir research/liftcut-agent/outputs/decisions
```

## Real tokenizer and loss-mask validation on CPU

The candidate is `Qwen/Qwen3-4B-Instruct-2507`, pinned to revision
`cdbee75f17c01a7cc42f958dc650907174af0554`. This is an already instruction-tuned
checkpoint; future "unadapted vs SFT" means before/after our additional training,
not pretraining from scratch. Its [official model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
documents a 4B, non-thinking model under Apache 2.0. Its tool-aware template accepts
structured function calls; see [Transformers tool-use guidance](https://huggingface.co/docs/transformers/chat_extras).

Only tokenizer/config/license files were downloaded: 11,444,101 bytes. All four
file hashes and the immutable revision are in the
[tokenizer profile](../../research/liftcut-agent/configs/qwen3-4b-tokenizer.json).
No model weights or training framework were installed in the isolated tokenizer
environment. The machine's existing Python had a NumPy binary incompatibility;
the successful run used a separate ignored `.venv` instead of modifying it.

For every decision, render the history with the generation prefix and the full
conversation with its target. Require the former token sequence to be an exact
prefix of the latter. Label all prefix tokens `-100`, supervise only the final
assistant continuation including its end marker, and reject empty targets or
silent truncation. This does not depend on a template automatically returning
assistant masks. Framework training integration must still preserve these labels;
see [TRL's SFT documentation](https://huggingface.co/docs/trl/sft_trainer).

Actual [CPU audit](../../research/liftcut-agent/reports/qwen-mask-audit-2026-09-28.json):
**59 decisions, 104,177 masked prompt tokens, 2,766 supervised tokens**, maximum
sequence **2,973 tokens** under a 4,096 limit, no truncation, and all prefix tokens
masked. Counts include repeated context across decision rows; they are not 59
independent tasks. Decoded targets, hashes and library versions are saved.

```sh
python -m venv research/liftcut-agent/.venv
# Windows; use .venv/bin/python on Linux/macOS:
research/liftcut-agent/.venv/Scripts/python -m pip install -r research/liftcut-agent/requirements-tokenizer.txt
python research/liftcut-agent/fetch_tokenizer.py --output-dir research/liftcut-agent/outputs/qwen-tokenizer
research/liftcut-agent/.venv/Scripts/python research/liftcut-agent/tokenize_decisions.py --decisions-dir research/liftcut-agent/reports/development-decisions-2026-09-28 --tokenizer-dir research/liftcut-agent/outputs/qwen-tokenizer --output-dir research/liftcut-agent/outputs/mask-audit --max-length 4096
```

All output commands refuse existing destinations. Core replay/tests remain
standard-library-only. The optional tokenizer audit pins Transformers 4.57.6,
Tokenizers 0.22.2 and Jinja2 3.1.6. CI runs the offline matrix/export and separately
reproduces the real tokenizer report with public hash-pinned files, no credentials,
GPU or paid inference.

## Verification and remaining work

The increment adds 14 protocol and 17 data/comparison tests to the prior 114 tests.
Legacy raw-response replay remains unchanged. Model performance after protocol
revision remains unmeasured because the live launch did not execute.

Next: resolve the execution environment's paid-run gate or use a permitted manual
run; audit the four completed cells without changing their plan. Review pending
approval labels, author and independently review additional grouped scenarios,
then freeze held-out evaluation. Verify the trainable model's actual function-call
parser, serving configuration and optimizer loss masks before collecting a larger
dataset or training. See the [concrete GPU pilot and budget](2026-09-28-small-model-pilot-plan.md).
