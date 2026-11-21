# Data model

Better Auth owns accounts and sessions. Institution membership links accounts to one or more roles. HOD grants carry a department. Catalog owners define tenant-scoped departments, schemes, terms, courses and sections. An offering pairs a course and section in a term. Roster rows assign faculty and enroll students.

Assignment publication records time and fixes the deadline and grading ceiling. Each active enrolled student can submit once. Grade revisions track draft, superseded, and published states. Student reads select the latest published revision only. Attachments reference a single assignment or submission within its institution.

Notices carry institution, department or offering scope, an author and publication time. Enrollment-letter requests move from submitted to in progress, then resolved or declined with a recorded outcome. Scope validation ties each workflow to active grants. Audit records reference entity identifiers and actor accounts and are append-only for the application role.

Ended roster and role grants retain links to past academic records and are revocable without deletion. Institutional retention periods, authoritative imports, account recovery and offboarding require approval before a pilot.
