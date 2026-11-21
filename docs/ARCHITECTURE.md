# Architecture

NEXUS uses a single Next.js application with React, TypeScript, Tailwind, Better Auth and PostgreSQL. Server-rendered workspaces obtain a session and resolve an active institution and role from database grants. Server actions validate inputs then call domain services. Use the file route for private downloads and the health route for readiness.

Separate domain services handle institutional setup, academic catalogs, assignments, file storage, communication, service requests and reporting. Write transactions validate current memberships and relevant assignments or enrollments, then mutate records and write audit events atomically. Reporting queries aggregate existing rows without AI or separate infrastructure.

Identity and workflow already have shared domain components. Academic and notice records establish the activity and knowledge layers. AURA remains an intelligence-layer roadmap item. Keep its future provider and tool boundaries behind existing authorization paths. Use explicit PostgreSQL relationships for early Outcome Graph experiments.
