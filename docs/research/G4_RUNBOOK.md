# G4 continuous-lease execution

This procedure is valid only inside the explicitly authorized 2026-10-03 overnight
lease. It does not grant a new opening or extend a deadline. Original boot is
05:35:00.409447 UTC; power deadline14:00 UTC, cumulative reserveCNY20 at2.18/hour.
See [design](2026-10-03-g4-memory-order-design.md) for fixed scientific conditions.

1. Check exact preparation/execution source hashes, two identical CPU preparations,
   production-path scripted drill and actual historical-weight container restoration.
   Scripted evidence is never model performance. Run the full offline suite and
   final-commit CI before GPU dispatch.
2. Stage a delta Git bundle from the unchanged `eaa1325...` checkout and only the new
   prepared inputs. Existing pinned model, diagnostic/D2/tokenizer assets are reused
   only after verification. Install into a separate exact-commit checkout and data
   directory. Never mutate the G3 checkout, weights, original evidence or guard.
3. `launch_g4_overnight.py` verifies the real existing lease/guard identity, completed
   G3 receipt, clean checkout, idle GPU and absence of an existing controller/worker.
   It reserves `g4-dispatch-reservation.json` exclusively before launching once.
   Trial start is captured after preflight, separately from the original boot.
   An unknown outcome is inspected, never automatically dispatched again.
4. Train/evaluate control, then train/evaluate permuted, then audit. Work is bounded
   by min(trial start+120min,11:45 UTC); collection by min(work+45min,12:30 UTC).
   Launch requires at least95min of work time. Each worker checks exact source/data
   and the original continuous power lease. No extra seed, API, disk expansion or reboot.
5. Copy immutable training archives as soon as each arm ends. The collector uses
   bounded eight-block reads with exact lengths and SHA256; failed partial files
   stay preserved. A complete receipt requires actual two new weight files, matching
   initialization,222 native/environment replays and every generated token audit.
   Partial archives remain partial and receive no complete-model claim.
6. Publish only the genuine frozen-restorer receipt using temporary upload/readback
   and atomic no-overwrite rename. Record upload, publication and server consumption
   separately. The controller leaves the independent14:00 power guard intact and
   does not shut down between authorized overnight pilots. Disconnect is not billing
   confirmation. No manual ACK construction.
7. Review original gates, new-control paired case gains/losses, all-position memory,
   false stops and fixed S0 protections. The historical G3 comparison independently
   reports initialization,all126 logged updates and final weight SHA; it cannot
   replace this new control if reproduction differs. Preserve all48 reserved tasks.
8. Publish evidence excluding weights/credentials, update the research journal and
   morning capability/shortfall/ETA report, pass exact-head checks and merge.
   At14:00 observe guard request/return and transport status; record provider billing
   separately. Retain data and avoid automatic relaunch/reconnect loops.

If local collection ends unexpectedly, inspect its session, process and partials
before choosing a fresh recovery directory with the same original cutoffs. Do not
rerun the launcher. No automatic retry path changes experimental conditions.
