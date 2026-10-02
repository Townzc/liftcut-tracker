# D2 fixed-seed42 operating runbook

Read [scope, calibration and limits](2026-10-02-d2-execution-readiness.md) first.
No live server is needed to build or test these assets. Do not reuse R1 deadlines,
restart old monitors, install packages, launch training or access reserved tasks.

After the [partial S0 window](2026-10-02-d2-partial-results-and-repair.md), use the
v2 controller and maintained `launch_d2_remote.py` below. That window completed
80 cases, then failed in archive registration; T/M/TM never ran. Preserve its
original code/receipt and repeat all four arms in a new window. The new exact
checked commit replaces the controller/deployment sources only; scientific
conditions must match historical v1. The existing clean cloud checkout
`06654db287a5d51c4aad6bf57fcee40d21555afc` is an offline bundle base, not the next
execution target. Do not dispatch an old generated `launch.sh`.

## Offline release gate

1. Reproduce the CPU D2 preparation and `prepare_d2_execution.py --prepared-dir …`.
2. Run `python -m unittest discover -s research/liftcut-agent/tests -v`.
3. Run `drill_d2_execution.py --prepared-dir … --tokenizer-dir … --adapters-root …
   --output-dir NEW_LOCAL_DIRECTORY`. It must report320 native/environment episodes,
   352 scripted responses,272 recomputed forecasts, actual original adapter bytes
   verified, full recovery, and `production_phase_and_early_archive_path_exercised`.
   It must use the same `execute_phases` function as production, including all four
   archive/index transitions. There are no real model or shutdown calls.
4. Commit the controller/deployment amendment on a branch. Its final exact PR head must pass every
   GitHub check before merging; verify the merge tree equals the checked tree.
   Preserve the old PR28 ref and v1 plan for the partial-window audit. Verify that
   `analyze_d2_partial.py --metadata-only --check` reproduces all public S0 results
   and accepts only the enumerated v2 source amendment.
5. Create a new incremental stage for that final checked commit and the real pinned
   tokenizer. The old clean base must remain available on the same instance:

```text
python research/liftcut-agent/stage_d2_execution.py
  --execution-commit CHECKED_40_HEX_SHA --source-ref CHECKED_BRANCH_REF
  --base-commit 06654db287a5d51c4aad6bf57fcee40d21555afc
  --opening-id UNIQUE_ID --prepared-dir LOCAL_D2_PREPARED
  --tokenizer-dir LOCAL_PINNED_TOKENIZER --output-dir NEW_LOCAL_STAGE
```

The invocation is one command; line breaks above are for readability. Bundle only
that explicit ref. `stage.json` describes paths, checksum inventory, first-upload
files, `bundle_base_commit`, v2 execution-plan SHA and arm command. Before asking
for another opening, apply this **actual final bundle** locally with
`d2_bundle.install_bundle` into a fresh checkout from the clean06654db base.
Verify exact HEAD, clean tree, v2 source hashes, unchanged base and total payload
bytes. A temporary toy-Git test alone is insufficient. Do not send a full-history
bundle again. A missing/dirty remote base ends setup rather than causing downloads
or an extended budget. The launcher uses that inventory, but creates fresh
ops/run paths and verifies any existing immutable checkout/data. It does not use
the stage's historical ops/run names or its legacy `launch.sh`. Copy the
template `configs/d2-monitor.template.json` into ignored local outputs, fill its
checked commit and endpoint, and keep `booted_at:null` until an actual opening.
Do not put credentials in config or scripts. Offline monitor preflight verifies
local actual weights, pinned tokenizer and free disk. Set `restore_python` to the
pinned tokenizer virtual environment, not to the Paramiko transport interpreter.
Run the new entry point's default offline mode from the repository root:

```text
TRANSPORT_PYTHON research/liftcut-agent/launch_d2_remote.py --config LOCAL_CONFIG
```

On the current Windows machine the transport interpreter is `E:/anaconda/python.exe`
and restoration uses `research/liftcut-agent/.venv/Scripts/python.exe`. The
transport environment must not import Transformers. No package install is needed.

## Once the user opens the same 4090 instance

The operator is the assistant; the user only needs to open the instance and give
changed connection information. Capture the earliest observed opening timestamp.
Use existing known_hosts verification and an in-memory password or authorized key;
never write the password into Git, command text, JSON or the public runbook.

1. Confirm the previous rental is off and record its actual bill if available.
   Reserve CNY5 for this separate attempt at the previously supplied2.18/hour;
   failed-opening cost remains separate. A changed instance/price requires rechecking
   the quote. Never turn on a rental automatically or expand storage.
2. Run the following **once**, using the actual earliest aware UTC opening proxy
   and a fresh simple ID. Keep the terminal session for the entire collector:

```text
TRANSPORT_PYTHON research/liftcut-agent/launch_d2_remote.py
  --config LOCAL_CONFIG --stage-dir CHECKED_V2_INCREMENTAL_STAGE
  --opening-id NEW_UNIQUE_ID --booted-at ACTUAL_EARLIEST_UTC --execute
```

   Line breaks above are for readability. Password is entered only through the
   interactive prompt. The launcher first invokes the pinned local preflight,
   uses verified known_hosts, and opens one SSH connection. It never retries an
   ambiguous launch automatically.
3. The launcher verifies the two small frozen bootstrap files and arms the original
   120-minute setup guard using fresh ops paths. It adopts the earlier of supplied
   time and container start, then arms the additional ten-minute prelaunch guard.
   Observe both armed records before bulk upload. It checks existing4090, package
   versions, model/adapter presence and ≥3GB free, without installing anything.
4. The existing stage is reusable only after remote full/prefix SHA256 verification.
   Matching partial files receive just their missing suffix; complete matching
   files are skipped. Mismatches/symlinks/oversize targets are preserved and rejected.
   Progress counts queued bytes; only close plus full size/hash verification means
   transfer completed. Every operation uses the original ten-minute setup budget.
5. The launcher verifies the immutable06654db base, copies it locally into a new
   commit-addressed checkout without hardlinks, and applies the verified incremental
   bundle without network access. It verifies exact new HEAD/clean tree, leaving
   the base unchanged, then checks/extracts the
   bounded public asset inventory, and records exclusive dispatch intent before
   invoking frozen `d2_setup.py`. The controller must open within the original
   allowance. The same connection then runs the existing collector, with restoration
   in the pinned local interpreter. Do **not** start a second monitor. Inspect the
   saved original boot/config, controller intent/PID/opening/guards and real process
   if a launch outcome is ambiguous. Opening itself is not proof of model execution.
6. Save local process/session ID and absolute work/hard deadlines in ignored
   `outputs/autodl/HANDOFF.md`. If using the existing heartbeat mechanism, monitor
   this specific run quietly unless a stage ends, fails or needs human action.
   A functioning controller/collector is never automatically restarted.

## Failure or lost connection

- The extra setup guard requests shutdown at boot+10 minutes unless a valid
  controller opening was observed. The original setup/controller guards preserve
  the hard deadline independently of SSH. The local launcher also requests immediate
  shutdown on setup failure before dispatch. A lost shutdown return is unknown;
  ask for platform status instead of repeatedly opening new sessions.
- Do not restart this launcher on the same opening. Inspect existing receipts and
  processes first. After an explicitly authorized later opening, use a new ID and
  actual new boot; never reuse old ops/run directories or reset a live deadline.
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
