# Test report

## November 21, 2026

| Check | Evidence |
| --- | --- |
| Lint and type check | `npm run lint` and `npm run typecheck` |
| Production build | `npm run build` compiled all workspaces and routes |
| PostgreSQL migrations | Applied all six migrations to a clean database and reran without pending changes |
| Restricted-role integration | Four tests via `npm test` exercised assignment state, cross-tenant and section permissions, duplicate and late submissions, unpublished feedback, grade revisions, concurrent writes, revoked access, notice scope, service requests, and transactional rollback |
| Chromium end to end | Three journeys passed against the production build with fictional accounts. Covered assignments and feedback, a disconnected submission response, scoped notices, an enrollment-letter request, principal reporting, administration, keyboard navigation, and a mobile viewport |
| Persistence | Stopped and started PostgreSQL against the same local data directory. Assignment, submission, published grade revision, and audit counts matched |
| Dependencies | `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities at the time of the run |

Earlier browser runs identified an HTTP status issue on streamed denials and an empty optional file that the multipart parser presented as an upload. The route now authorizes before sending its response and accepts an empty generic file field as absent. The browser also verified that admin role and roster changes work against the database.

Hosted smoke tests, production monitoring, backup restore and institutional user validation require access to the release environment.
