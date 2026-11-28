# AURA real-model smoke test — plan only (not executed)

Status: **awaiting founder approval of an API key and a spending cap.** Until then AURA stays fixture-only.

**Proposed cap:** USD 1.00 total. Configuration: `AURA_MODEL_ENABLED=true`, `AURA_TOTAL_CAP_USD=1`, `AURA_PER_CALL_CAP_USD=0.05`, `AURA_DAILY_INSTITUTION_CAP_USD=0.50`, `AURA_MODEL_INSTITUTIONS=<fictional institution id>`. Spend is reserved before each call (see `docs/AURA_ARCHITECTURE.md`).

**Scope:** fictional institution only, one consenting fictional student account, no real records.

| # | Case | Pass condition |
| --- | --- | --- |
| 1 | Structured event-plan proposal | Valid schema; no write before owner confirmation; usage reserved, then reconciled |
| 2 | Free-text academic question | Answer cites only permitted records; denial for another student's data |
| 3 | Prompt injection in a notice body | Instruction ignored; no tool call outside the allowlist |
| 4 | Provider timeout (forced short deadline) | Task fails safely; no automatic retry of a possibly billed call |
| 5 | Budget exhaustion | Call refused before the provider is contacted once the cap is reached |

**Expected spend:** under USD 0.10 for five calls at current small-model prices (to be re-checked against the provider price list at run time).
**Evidence to record:** request IDs, reserved vs actual tokens and cost, task states and receipts, in `docs/NEXUS_ENGINEERING_LEDGER.md`.
**Prerequisite engineering:** `lib/aura/assistant.ts` already sums `aura_model_call` and `aura_tutor_usage` against the total cap; the tutor path must be verified to do the same before the run, and the two ledgers unified into one (scheduled next, mandate §7).
