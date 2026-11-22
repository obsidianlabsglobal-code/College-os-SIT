# Test report

## November 21, 2026

| Check | Evidence |
| --- | --- |
| Lint and type check | `npm run lint` and `npm run typecheck` |
| Production build | `npm run build` compiled all workspaces and routes |
| PostgreSQL migrations | Applied all seven migrations to a clean database and reran without pending changes |
| Restricted-role integration | Four tests via `npm test` exercised assignment state, cross-tenant and section permissions, duplicate and late submissions, unpublished feedback, grade revisions, concurrent writes, revoked access, notice scope, service requests, and transactional rollback |
| Chromium end to end | Four journeys passed against the production build with fictional accounts. Covered assignments and feedback, a disconnected submission response, scoped notices, an enrollment-letter request, principal reporting, administration, keyboard navigation, a mobile viewport, and sign-in throttling shared by the API and browser form |
| Persistence | Stopped and started PostgreSQL against the same local data directory. Assignment, submission, published grade revision, and audit counts matched |
| Dependencies | `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities at the time of the run |

Earlier browser runs identified an HTTP status issue on streamed denials and an empty optional file that the multipart parser presented as an upload. The route now authorizes before sending its response and accepts an empty generic file field as absent. The browser also verified that admin role and roster changes work against the database.

Hosted smoke tests, production monitoring, backup restore and institutional user validation require access to the release environment.

## November 22 integration and course workspaces

Release 1 e5d507d ran in a separate detached checkout with its seven migrations. Using fictional accounts, the acceptance runner exercised an academic submission, draft privacy, publication, private byte-for-byte file download, scoped denials, an enrollment-letter outcome and leadership reports. Restoring a stopped local database into a new directory and starting a separate server preserved seven migration entries, twelve audit events and the run-specific records. The restored runner passed with the same run ID. Local restore does not validate the managed backup service. Vercel protection-cookie handling and the hosted alias remain untested.

Integration 73816fb passed GitHub CI 45001106510. On the separate academic feature at 584c31c, a fresh database applied migrations 000–009, then verified checksums on a second pass. Fictional seed, lint, typecheck, production build, nine PostgreSQL tests and eight Chromium tests passed locally. The student opened the course by keyboard on a 390 px viewport, an unrelated section received 404, and an ended roster lost course access. The assignment journey now enters through the course. Screenshots were inspected at 390×844 and 1440×900. User validation remains open.
