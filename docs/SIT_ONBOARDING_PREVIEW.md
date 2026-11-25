# SIT onboarding preview

This branch starts AD-002 and ID-009 with a fictional rehearsal. It neither
collects campus data nor enables a new sign-in method. No migration is applied
to the hosted demo by this branch. The demo continues to use its existing accounts.

## Rehearsal

1. Use a fresh local PostgreSQL database, run the normal migrations and seed the
   fictional accounts as documented in the README.
2. Run the app with `NEXUS_ONBOARDING_PREVIEW=true`. The default is off. Connect
   no live Google credentials. Use `/join/student`, `/join/faculty` and
   `/join/staff` to rehearse QR landing copy; QR links have no authority.
3. Sign in to the local example admin workspace and open Academic setup →
   Student admissions preview. Record a made-up address ending in
   `@nexus.example.invalid` and select the authorized tenant's section and
   term. Reload and revoke the example approval. Creating an approval grants
   no role, creates no user or session, and does not enroll a student in courses.
4. Run `npm test` against fresh local fixtures with both database URLs set.
   With the built app, run `npm run test:e2e -- tests/student-admission.e2e.ts`
   once with the flag on for the rehearsal and once off for the hidden route.

The preview requires an active institutional administrator to write, limits
approvals to the student workflow and writes metadata-only audit entries.
Faculty and staff landing pages are informational only. Section and term must
belong to the current institution and a normalized email can hold only one
active approval per institution.

## Before enrolling real people

- SIT must approve the pilot population, the people who can admit/revoke users,
  and handling and retention of the minimum identity and enrollment fields.
- Add Google OpenID Connect with explicit issuer, audience, expiry and verified
  identity checks, with the exact roster email checked only for initial admission.
  Persist the stable Google subject as identity; block silent links to existing
  privileged accounts. Store no Google access/refresh token without a use case.
  [Google identity guidance](https://developers.google.com/identity/openid-connect/openid-connect).
- Atomically connect an approved roster entry to a verified identity and issue
  only the approved student membership and explicit course grants. Revoke the
  applicable grant, and invalidate the applicable sessions, when SIT withdraws access.
  A QR, requested role, section label, or possession of a Google address cannot
  grant membership. Use a different approval and step-up lane for privileged roles.
- Verify both approved and unapproved Google accounts end-to-end in a dedicated
  test deployment, and rehearse expiry, revocation, isolation, and the expected
  class-change login burst before an EEE cohort rollout.

## Verification evidence

On 2026-11-25, all 17 migrations applied on a fresh local PostgreSQL instance;
reapplying the migration ledger was a no-op. Lint, TypeScript and the production
build passed. All 47 service/database checks and all 23 standard Chromium
journeys passed. A separate Chromium run with the preview disabled confirmed
the entry returned 404. No Google OAuth, hosted rollout or real records were tested.
