# D2 fixed-seed42 operating runbook

Read [scope, calibration and limits](2026-10-02-d2-execution-readiness.md) first.
No live server is needed to build or test these assets. Do not reuse R1 deadlines,
restart old monitors, install packages, launch training or access reserved tasks.

## Offline release gate

1. Reproduce the CPU D2 preparation and `prepare_d2_execution.py --prepared-dir …`.
2. Run `python -m unittest discover -s research/liftcut-agent/tests -v`.
3. Run `drill_d2_execution.py --prepared-dir … --tokenizer-dir … --adapters-root …
   --output-dir NEW_LOCAL_DIRECTORY`. It must report320 native/environment episodes,
   352 scripted responses,272 recomputed forecasts, actual original adapter bytes
   verified, and full recovery. There are no real model or shutdown calls.
4. Commit on a branch. Final exact PR head must pass every GitHub check before merging.
   Preserve the checked branch ref for the offline bundle; use its exact40-hex SHA
   as execution commit. The merge tree must equal the checked head tree.
5. Stage with the real pinned tokenizer and prepared directory:

```text
python research/liftcut-agent/stage_d2_execution.py
  --execution-commit CHECKED_40_HEX_SHA --source-ref CHECKED_BRANCH_REF
  --opening-id UNIQUE_ID --prepared-dir LOCAL_D2_PREPARED
  --tokenizer-dir LOCAL_PINNED_TOKENIZER --output-dir NEW_LOCAL_STAGE
```

The invocation is one command; line breaks above are for readability. Bundle only
that explicit ref. `stage.json` describes paths, checksum inventory, first-upload
files and arm command. `launch.sh` is generated with shell quoting; it makes a
fresh checkout and extracts only the staged, hash-checked public assets. Copy the
template `configs/d2-monitor.template.json` into ignored local outputs, fill its
checked commit and endpoint, and keep `booted_at:null` until an actual opening.
Do not put credentials in config or scripts. Offline monitor preflight verifies
local actual weights, pinned tokenizer and free disk.

## Once the user opens the same 4090 instance

The operator is the assistant; the user only needs to open the instance and give
changed connection information. Capture the earliest observed opening timestamp.
Use existing known_hosts verification and an in-memory password or authorized key;
never write the password into Git, command text, JSON or the public runbook.

1. Connect once for setup; inspect container/GPU identity and current price. Never
   turn a rental on automatically. Upload only `d2_setup.py` and `shutdown_guard.py`
   into `stage.json`'s new `remote_stage`; verify their local/remote SHA256.
2. Invoke the exact `arm_argv_replace_boot_with_actual_observation` from `stage.json`,
   replacing the time placeholder with the actual aware UTC observation. Capture
   returned `booted_at_proxy`, setup opening, guard PID and armed record. The earlier
   container start proxy may shorten the window; never replace it with a later time.
3. Before bulk upload, verify ≥3GB free on `/root/autodl-tmp`, the historical model,
   original seed42 four adapter directories, existing Python environment and price.
   If missing/mismatched or the ten-minute launch allowance is exhausted, preserve
   evidence and request immediate shutdown using the existing AutoDL shutdown
   command; do not install, expand, reboot or extend.
4. Upload remaining staged files with their hashes and run `bash launch.sh` from
   the staging directory. The script checks hashes and has an immediate shutdown
   trap on setup error. It launches the controller detached; it does not wait for
   inference to finish. Observe `controller-launch.json`, PID, opening, both guards
   and actual live process/argv. If ambiguous, inspect; never blindly run again.
5. Put the **returned original proxy** into local monitor config. Confirm its
   remote_run/remote_ops match this stage and all local output directories are new.
   Start one `monitor_counterfactual_diagnostics.py --config LOCAL_CONFIG --connect`
   with the pinned local restoration Python. Password is prompted, not serialized.
6. Save local process/session ID and absolute work/hard deadlines in ignored
   `outputs/autodl/HANDOFF.md`. If using the existing heartbeat mechanism, monitor
   this specific run quietly unless a stage ends, fails or needs human action.
   A functioning controller/collector is never automatically restarted.

## Failure or lost connection

- Setup/controller guard preserves the original hard deadline independently of SSH.
  If setup fails and the trap cannot run, use the already authorized shutdown action
  or ask the user to turn the instance off; retain the armed guard as backstop.
- Inspect local files, events and actual process before recovery. A recovery monitor
  uses entirely new local downloads/restored/operations directories, the **same**
  boot proxy and remote run. It never changes running inference conditions.
- If the original hard deadline is past, do not reconnect or reboot to collect.
  Preserve what is local and ask for platform status. Missing data is documented.
- A complete archive is at most512MB compressed,1GB expanded and2,000 members.
  Inventory/path checks reject symlinks, duplicates, unsafe paths and altered bytes.
  Partial artifacts stay partial; never create or edit an ACK manually.
- After a real restorer passes, `transfer_receipt` writes an exclusive temporary
  file, verifies readback and uses no-overwrite rename. Rename ambiguity is unknown;
  a later authorized collector checks identical existing final bytes before acting.
- Controller waits at most15 minutes for receipt and always requests shutdown;
  the independent120-minute guard remains active. Do not cancel the guard after
  publication. Capture ACK consumption and shutdown-return records if observable.

## Publish and review after closure

Keep archive SHA256, actual restorer receipt, original code binding, native/token
audit and operational events. Never publish raw model weights, secrets or local
credentials. The audit already emits exact per-case results, paired gains/losses,
mode budgets, all panel denominators and the fixed G1 behavior gate.

Generate the scientific review and figures from independently reconstructed case
results. Describe repeated development states and fixed seed42 accurately. Update
the experiment log with observations, hypotheses, failures, actual or proxy costs
and the next gated experiment. Only then prepare a results branch and review its
final checked commit before merging. Request platform-off/billing confirmation;
SSH disconnect, an emitted shutdown command or a returned0 alone is not that proof.
