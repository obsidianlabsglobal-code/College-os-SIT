# Deployment

The release candidate targets a dedicated Vercel staging project with a separate managed PostgreSQL database on PostgreSQL 15 or newer. Confirm the stable HTTPS URL and that the hosting plan permits the intended use. Use Vercel deployment protection when available. Fictional staging can also use the application sign-in with a unique staging password. Set the Vercel project to Node 24 and retain its production alias for staging acceptance. Disable Git auto-deploys on this project so migration and release sequencing stay in the workflow.

## Provisioning

- Create a dedicated database, an owner or migration login, and a restricted login named `nexus_app`. In providers that require suffixes or alias usernames on pooled connections, use the provider connection string for the same restricted database role. Require TLS with provider certificate validation. Store runtime and migrations connections separately.
- Add `DATABASE_URL`, `BETTER_AUTH_URL` for the exact HTTPS alias, and a randomly generated `BETTER_AUTH_SECRET` to the Vercel production environment of the staging project. Better Auth stores sign-in rate counters in PostgreSQL and reads the client address supplied by the trusted Vercel proxy. Configure a provider-level limit for repeated authentication requests before institutional release.
- Create the GitHub environment `release-candidate` with authorized reviewers. Add secrets `VERCEL_TOKEN` and `MIGRATION_DATABASE_URL`. If Vercel deployment protection is enabled, also set `VERCEL_AUTOMATION_BYPASS_SECRET` for smoke tests. Add variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `RELEASE_URL`. Keep the migration credential out of Vercel application settings.
- After CI passes on main, dispatch **Deploy release candidate**. The workflow builds, runs the SQL migrations, deploys to the staging alias, and checks database readiness and its sign-in page. Use a separate controlled account-provisioning step for test users.

## Acceptance and recovery

Verify sign-in, scoped links, grade and notice publication, request handling, and denied access with approved fictional accounts. Re-deploy the same revision and confirm that prior records persist. Record the observed HTTPS URL and verification results in the test report. Use the Vercel deployment logs for application errors and monitor authenticated synthetic sign-ins separately from the public health status. The health endpoint returns 503 on database errors and excludes infrastructure details.

Enable managed backups and point-in-time recovery where the plan supports it. Before acceptance, restore to an isolated database and verify migrations, sign-in, representative workflow counts, and audit records. Establish an owner and recovery objectives with the product owner. To recover application service, restore a Vercel deployment compatible with the current database schema. Use a new forward migration for an incompatible database change, or an approved restore with a recorded data-loss window. Rehearse and record recovery before institutional data is authorized.

For a dedicated fictional release-candidate database, an authorized operator can set `NEXUS_DEMO_SEED=1`, `NEXUS_DEMO_DATABASE_HOST` to the exact migration URL hostname, and `NEXUS_DEMO_PASSWORD` to a unique staging-only secret of at least 24 characters. With the staging connection variables and auth configuration supplied securely, run `npm run db:seed` from the release checkout. The script checks for non-demo institutions and refuses to seed if present. Rerunning it retains existing account passwords. Keep the staging password in the team's secret manager.

## Authenticated acceptance from the integration checkout

The release runner exercises the unmodified Release 1 interface over HTTP(S). Use Node 24, npm ci and Playwright Chromium on the operator machine. Keep the deployed source pinned to green main. Select the dedicated fictional staging origin via RELEASE_URL, confirm its exact host via NEXUS_ACCEPTANCE_HOST and load NEXUS_DEMO_PASSWORD from the staging secret manager. If protected, supply VERCEL_AUTOMATION_BYPASS_SECRET for a same-origin bypass-cookie handshake. The protected-host handshake still needs hosted verification.

1. Record the deployed commit and alias, migration ledger names and checksums (seven on Release 1), backup ID and the authorized fictional institution. Set NEXUS_ACCEPTANCE_RUN to a fresh unique identifier.
2. Run `npx tsx scripts/release-acceptance.ts exercise` from the integration checkout. It creates identifiable fictional academic and service-request records, signs in five roles and two unauthorized personas, checks private bytes and persisted results. Operate below the auth rate limit and allow its window to elapse between exercises. Failure can leave partial fictional records. Preserve them and use a new identifier for a fresh exercise.
3. Redeploy the same app revision. Run `npx tsx scripts/release-acceptance.ts verify` with the original run ID. This reads the existing workflow records and exercises authentication again.
4. Restore the managed backup into an isolated instance with separate credentials. Check audit and migration counts against the snapshot, point a separate staging app at the restored instance, and repeat verify there. Record downtime, lost-write window, log access, outcomes and recovery owner before acceptance.
