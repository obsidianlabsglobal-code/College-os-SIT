# AURA architecture

The initial capability is a deterministic CLUBVERSE event planner. An authorized organizer enters event details, reviews the persisted preview, and confirms saving a private club event draft. The activity page shows the outcome and links to the underlying record. The same CLUBVERSE service enforces permissions and schedule rules for direct and assisted creation.

The gateway resolves the NEXUS authenticated workspace and then applies role and club checks. The registry declares version and tools. A provider interface accepts structured input and an abort signal, and its only current implementation is deterministic. Task persistence in migration 009 holds owner, workspace, club, version, mode, payload and outcome reference. Approval, event draft, execution metadata and audit commit together.

The current process is synchronous. It has no external model, knowledge corpus, durable worker or background scheduler. Add each only after a use case and approval justify it. Institutional Knowledge and Faculty Workflow assistants are planned and do not have runtime routes.

## Proposed model pilot for the event planner

The first question for a model is how to organize an event within constraints the organizer has already supplied. Compare its suggestions with the existing guided form. Measure organizer editing time, missing requirements caught, unsupported claims, and cost per draft accepted. Keep the deterministic path available throughout.

1. A server action resolves the session, institution, active club and officer grant. A narrow read tool returns the organizer's supplied date, capacity, location and requirements plus approved club rules with record ID and revision. Only the server chooses source IDs. An unknown booking or equipment availability stays unknown.
2. Introduce a separate suggestion-provider interface returning agenda items, equipment suggestions, questions and source references through a strict bounded schema. Limit text lengths and array sizes. Treat retrieved content as data. Reject unknown fields, unrecognized citations, instructions to execute tools and invented approval states. Render generated text as text. Let the organizer edit suggestions before review. Keep authoritative club, venue availability, audience, approved status, capacity and timestamps under deterministic control.
3. Launch with a single server-chosen read tool and one schema-constrained generation. The model receives no cookies, roster, secret, direct URL fetch, SQL or write tool. If tool requests become necessary, allowlist by name and schema and recheck live grants per call. Allow only approved providers, endpoint, model version, retention and region. Credentials remain server-only. Record policy and prompt versions.
4. Reserve worst-case input/output spend in a short transaction under institution and user caps, commit, then call the provider outside the transaction. Set explicit token, time and size limits. On timeout record an unknown-charge state and reconcile by provider request ID before releasing the reservation. Deduplicate on client operation ID. Do not retry an indeterminate paid call automatically. Record units, estimated versus billed cost, outcome, duration, tool and source references without copying prompts into routine logs.
5. Recheck role, club, source revisions and schedule after the response. Show suggested edits and unresolved questions. Use the existing persisted preview and owner confirmation for the exact edited proposal. Confirmation saves one private draft. The ordinary event approval and publication workflow still applies. A provider failure leaves the form usable.
6. Before enabling a pilot, run fictional cases for missing sources, contradictory capacity, prompt injection in club rules, forged citations, revoked officers during inference, another tenant's event, duplicated confirmations, malformed output, timeout after billing and exhausted budgets. Require zero unauthorized disclosures or writes and zero false claims of booking/approval in the evaluation set. Compare blinded organizer ratings with the form baseline and agree the spend limit before any billable execution.

Status: proposed. No external model call, approved provider account or measured quality advantage has been established.

## Academic assistant branch

The academic workspace accepts explicit local lookup intents for the current student's assignments, timetable and attendance, and the current instructor's timetable. Each answer links to its source workspace and uses that domain's existing membership and roster checks. Unrecognized text stays local. The existing CLUBVERSE confirmation path is unchanged.

An optional single-institution study pilot calls the Anthropic Messages API with a fixed curriculum topic. Only the topic prompt leaves NEXUS. A learner must explicitly select Generate explanation. Tool access, course-record grounding, free-text model chat and model-powered event planning remain future work. No streaming is needed for the bounded single response.

Configure the seven optional server variables in .env.example after approving the model, current prices and pilot budget. Each generated explanation is limited to 512 output tokens, one call, a 15-second timeout and five requests per actor per rolling 24 hours. Migration 013 tracks reservations and estimated spend in integer millionths of a US dollar. Institution locking and a unique operation ID protect admission. Unknown provider outcomes retain their reservation for the rolling window. There is no automatic paid retry or invoice reconciliation. An actor can see their five most recent estimates in their current workspace. Never put API keys in client configuration.

PostgreSQL tests exercise the real accounting and authorization code with an injected provider response. This is provider-contract evidence only. A live provider check, answer-quality evaluation and hosted rollout require separate evidence.

The dedicated Chromium contract journey runs with `npx playwright test --config playwright.tutor.config.ts` after a local production build, migration and fictional seed. Its isolated app process intercepts the provider request with a test fixture, uses a dummy key, and checks the mobile, keyboard-triggered topic selection, returned example and usage history after reload.
