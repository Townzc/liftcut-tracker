# I1: all 111 paired development states

Fresh raw vs fresh view. A diagnostic state is not necessarily a full user task. Every case appears once;37gains,0losses,74unchanged.

| Panel | Case | Raw | View | Change | First differing action raw → view |
| --- | --- | --- | --- | --- | --- |
| normal | r2-05-preview | 1 | 1 | same | — |
| normal | r2-05-approved | 1 | 1 | same | — |
| normal | r2-05-pending | 1 | 1 | same | — |
| normal | r2-05-declined | 1 | 1 | same | — |
| normal | r2-05-revoked | 1 | 1 | same | — |
| normal | r2-05-infeasible | 1 | 1 | same | — |
| normal | r2-05-missing_time | 1 | 1 | same | — |
| normal | r2-05-unanswered_time | 1 | 1 | same | — |
| normal | r2-05-missing_equipment | 1 | 1 | same | — |
| normal | r2-05-missing_days | 1 | 1 | same | — |
| normal | r2-05-memory | 1 | 1 | same | — |
| normal | r2-05-memory_missing_time | 1 | 1 | same | — |
| diagnostic | sd1-consent-pending-plain | 1 | 1 | same | — |
| diagnostic | sd1-consent-pending-read | 1 | 1 | same | — |
| diagnostic | sd1-consent-pending-blocked | 1 | 1 | same | — |
| diagnostic | sd1-consent-declined-plain | 1 | 1 | same | — |
| diagnostic | sd1-consent-declined-read | 1 | 1 | same | — |
| diagnostic | sd1-consent-declined-blocked | 1 | 1 | same | — |
| diagnostic | sd1-consent-revoked-plain | 1 | 1 | same | — |
| diagnostic | sd1-consent-revoked-read | 1 | 1 | same | — |
| diagnostic | sd1-consent-revoked-blocked | 1 | 1 | same | — |
| diagnostic | sd1-consent-approved-plain | 1 | 1 | same | — |
| diagnostic | sd1-memory-0-first-unconfirmed | 1 | 1 | same | — |
| diagnostic | sd1-memory-0-first-expired | 1 | 1 | same | — |
| diagnostic | sd1-memory-0-last-unconfirmed | 1 | 1 | same | — |
| diagnostic | sd1-memory-0-last-expired | 1 | 1 | same | — |
| diagnostic | sd1-memory-1-first-unconfirmed | 1 | 1 | same | — |
| diagnostic | sd1-memory-1-first-expired | 1 | 1 | same | — |
| diagnostic | sd1-memory-1-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["dumbbell"]} |
| diagnostic | sd1-memory-1-last-expired | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["dumbbell"]} |
| diagnostic | sd1-memory-time-control | 1 | 1 | same | — |
| d2 | d2-memory-v0-c0-first-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c0-first-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c1-first-unconfirmed | 1 | 1 | same | — |
| d2 | d2-memory-v1-c0-first-unconfirmed | 0 | 0 | same | search_exercises {"equipment":["bodyweight"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v2-c0-first-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v3-c0-first-unconfirmed | 1 | 1 | same | — |
| d2 | d2-identity-v0-c0-first-unconfirmed | 0 | 0 | same | — |
| d2 | d2-identity-v0-c1-last-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-consent-pending-plain | 1 | 1 | same | — |
| d2 | d2-consent-revoked-memories | 1 | 1 | same | — |
| d2 | d2-repair-unknown_evidence-v0 | 1 | 1 | same | — |
| d2 | d2-infeasible-unknown_evidence-v0 | 1 | 1 | same | — |
| d2 | d2-memory-v0-c0-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c0-middle-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c0-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c0-last-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c1-first-expired | 1 | 1 | same | — |
| d2 | d2-memory-v0-c1-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c1-middle-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c1-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v0-c1-last-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-memory-v1-c0-first-expired | 0 | 0 | same | search_exercises {"equipment":["bodyweight"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v1-c0-middle-unconfirmed | 0 | 0 | same | search_exercises {"equipment":["bodyweight"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v1-c0-middle-expired | 0 | 0 | same | — |
| d2 | d2-memory-v1-c0-last-unconfirmed | 0 | 0 | same | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v1-c0-last-expired | 0 | 0 | same | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v1-c1-first-unconfirmed | 1 | 1 | same | — |
| d2 | d2-memory-v1-c1-first-expired | 1 | 1 | same | — |
| d2 | d2-memory-v1-c1-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["machine"]} |
| d2 | d2-memory-v1-c1-middle-expired | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["machine"]} |
| d2 | d2-memory-v1-c1-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["machine"]} |
| d2 | d2-memory-v1-c1-last-expired | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["machine"]} |
| d2 | d2-memory-v2-c0-first-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c0-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c0-middle-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c0-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c0-last-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c1-first-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c1-first-expired | 1 | 1 | same | — |
| d2 | d2-memory-v2-c1-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c1-middle-expired | 0 | 1 | gain | search_exercises {"equipment":["machine"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c1-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v2-c1-last-expired | 0 | 1 | gain | search_exercises {"equipment":["machine"]} → search_exercises {"equipment":["bodyweight"]} |
| d2 | d2-memory-v3-c0-first-expired | 1 | 1 | same | — |
| d2 | d2-memory-v3-c0-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v3-c0-middle-expired | 1 | 1 | same | — |
| d2 | d2-memory-v3-c0-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["bodyweight"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v3-c0-last-expired | 1 | 1 | same | — |
| d2 | d2-memory-v3-c1-first-unconfirmed | 1 | 1 | same | — |
| d2 | d2-memory-v3-c1-first-expired | 1 | 1 | same | — |
| d2 | d2-memory-v3-c1-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v3-c1-middle-expired | 0 | 1 | gain | search_exercises {"equipment":["bodyweight"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v3-c1-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["barbell"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-memory-v3-c1-last-expired | 0 | 1 | gain | search_exercises {"equipment":["bodyweight"]} → search_exercises {"equipment":["dumbbell"]} |
| d2 | d2-identity-v0-c0-first-expired | 0 | 0 | same | — |
| d2 | d2-identity-v0-c0-middle-unconfirmed | 0 | 0 | same | — |
| d2 | d2-identity-v0-c0-middle-expired | 0 | 0 | same | — |
| d2 | d2-identity-v0-c0-last-unconfirmed | 0 | 0 | same | — |
| d2 | d2-identity-v0-c0-last-expired | 0 | 0 | same | — |
| d2 | d2-identity-v0-c1-first-unconfirmed | 1 | 1 | same | — |
| d2 | d2-identity-v0-c1-first-expired | 1 | 1 | same | — |
| d2 | d2-identity-v0-c1-middle-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-identity-v0-c1-middle-expired | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-identity-v0-c1-last-unconfirmed | 0 | 1 | gain | search_exercises {"equipment":["dumbbell"]} → search_exercises {"equipment":["barbell"]} |
| d2 | d2-consent-pending-context | 1 | 1 | same | — |
| d2 | d2-consent-pending-memories | 1 | 1 | same | — |
| d2 | d2-consent-declined-plain | 1 | 1 | same | — |
| d2 | d2-consent-declined-context | 1 | 1 | same | — |
| d2 | d2-consent-declined-memories | 1 | 1 | same | — |
| d2 | d2-consent-revoked-plain | 1 | 1 | same | — |
| d2 | d2-consent-revoked-context | 1 | 1 | same | — |
| d2 | d2-consent-approved-plain | 1 | 1 | same | — |
| d2 | d2-consent-approved-context | 1 | 1 | same | — |
| d2 | d2-consent-approved-memories | 1 | 1 | same | — |
| d2 | d2-repair-unknown_evidence-v1 | 1 | 1 | same | — |
| d2 | d2-repair-session_count_mismatch-v0 | 1 | 1 | same | — |
| d2 | d2-repair-session_count_mismatch-v1 | 1 | 1 | same | — |
| d2 | d2-infeasible-unknown_evidence-v1 | 1 | 1 | same | — |
| d2 | d2-infeasible-session_count_mismatch-v0 | 1 | 1 | same | — |
| d2 | d2-infeasible-session_count_mismatch-v1 | 1 | 1 | same | — |
