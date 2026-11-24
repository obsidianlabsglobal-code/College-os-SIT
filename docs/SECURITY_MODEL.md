# Security model

The browser sends form data and a workspace selection. Server-side code resolves the authenticated account and verifies active membership before use. Domain queries constrain reads by tenant, department, offering and ownership. Transactions check and lock current permissions for critical operations. Composite foreign keys prevent linking records across tenants. The PostgreSQL runtime role is distinct from the migration owner and shares a database across tenants, so application query scope remains a security boundary.

Better Auth owns session cookies and password hashing. Public registration is disabled. Initial administrators and members are provisioned by an authorized operator. Administrators can delegate scoped student, faculty, HOD and principal grants within their institution. Administrator promotion is an operator action.

Files are limited to 4 MiB at application intake, validated for text or basic PDF structure, and served through authorized download routes with cache and content-sniffing controls. PDF validation checks format markers. A real pilot requires private object storage, malware scanning and retention policy confirmation. Release staging uses a separate hosting project and fictional records behind authenticated workflows. Verify the hosting edge forwards the trusted client address and tune throttling with the pilot's network patterns. Apply institutional privacy and academic requirements only after verification. A guardian relationship alone confers no access.

### Release and assistant trust boundaries

| Threat | Enforced control | Residual exposure |
| --- | --- | --- |
| Misrouted migration or leaked database credential | Before a remote connection, match the password-free endpoint, database, port and project-qualified user to the independently configured NEXUS target. Restrict the migration secret to its workflow step. | A compromised settings administrator can alter both the allowlist and the secret. Rotate credentials and review environment changes. |
| Cross-institution reads or stale access | Domain services check current membership and roster, including when reopening AURA results. | A stolen active session inherits the user's remaining grants. |
| Instructions embedded in external text | Direct lookups use fixed tools. Model interpretation needs consent, a configured institution and an allowed capability. Event writes require server-side review and confirmation. | Live provider quality, retention and external data approval remain unverified. |
| Framing or document MIME confusion | Response headers restrict framing, embedded objects and base URLs, and disable MIME sniffing. React escapes rendered text. | These directives do not implement a nonce-based script policy or malware scanning. |
| Provider failure or ambiguous charges | Deterministic workflows operate without a provider. The ledger reserves cost and retains uncertain charges. | Billing reconciliation remains an operator task. |

For a dedicated Supabase deployment, disable its Data API when unused or exclude the Better Auth and NEXUS tables from exposed schemas. Check effective privileges for public API roles before applying migrations; provision RLS and explicit grants if exposure is required. Better Auth sessions are resolved by NEXUS. A Supabase project-level setting does not validate NEXUS memberships. No hosted configuration has been inspected or certified by these local tests.
