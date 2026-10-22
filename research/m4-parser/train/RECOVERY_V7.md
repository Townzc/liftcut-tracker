# V7 recovery and storage preparation

V7 plans one fresh candidate plus cached H/T controls. The versioned
[backup helper](backup_v7.py) requires four candidate weights (adapter, merged,
F16 and Q8), all five complete prediction streams, logs and source. A stopped
run may remain partial; a completed run cannot silently omit weights or streams.
Window ID, exact commit and original work deadline are explicit; old v6 windows
are rejected. The helper does not authorize connection, power off or prove OFF.

Storage is recalculated for the changed experiment, not lowered inside v6:

| Requirement | Bytes |
| --- | ---: |
| Four candidate weights, measured from v6 | 3,070,186,192 |
| Full archive duplicate | 3,070,186,192 |
| Converter workspace allowance | 1,073,741,824 |
| Source, logs, dependencies and temporary reserve | 3,221,225,472 |
| Total | 10,435,339,680 |

Round up to **10 GiB live free on the chosen output filesystem**. V6's 16 GiB
two-model check is unchanged. The previous 78.57% data-disk usage is historical,
not an assertion of current free bytes. Check the existing root/data filesystems
after setup and choose a separate fresh output path only where the check passes.
Retain old assets; stop on insufficient space instead of deleting or upgrading.

Actual CPU validation: eight Linux fault tests cover full/staged restore,
partial completion, corrupted archive/weight, missing weight/stream, wrong
window/deadline, traversal, symlink and a real pack/restore round trip.
[The full artifact rehearsal](../results/prompt-v7-20261022/artifact-restore.json)
then restored 3,121,069,088 bytes, four **historical v6 weights**, five historical
1,040-row streams and metadata from a 24-part full archive. Every restored file
was hashed. No predictions were generated; the fixture's below-threshold state
is not a v7 result. Its embedded source bundle is the data-preparation commit;
final runner/source restoration is a separate readiness condition.

Only notify a fresh GPU opening after runner/input checks, full/incremental
source recovery and every exact-head CI check pass. Bind work to opening +3h,
reserve the fourth hour for backup/shutdown, and verify platform OFF before
clearing its timer. Preparation does not activate a model or change confirmations.
