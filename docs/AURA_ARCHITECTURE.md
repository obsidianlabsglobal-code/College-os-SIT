# AURA architecture

The initial capability is a deterministic CLUBVERSE event planner. An authorized organizer enters event details, reviews the persisted preview, and confirms saving a private club event draft. The activity page shows the outcome and links to the underlying record. The same CLUBVERSE service enforces permissions and schedule rules for direct and assisted creation.

The gateway resolves the NEXUS authenticated workspace and then applies role and club checks. The registry declares version and tools. A provider interface accepts structured input and an abort signal, and its only current implementation is deterministic. Task persistence in migration 009 holds owner, workspace, club, version, mode, payload and outcome reference. Approval, event draft, execution metadata and audit commit together.

The current process is synchronous. It has no external model, knowledge corpus, durable worker or background scheduler. Add each only after a use case and approval justify it. Institutional Knowledge and Faculty Workflow assistants are planned and do not have runtime routes.
