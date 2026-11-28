# Deployment

The release candidate targets a dedicated Vercel staging project with a separate managed PostgreSQL database on PostgreSQL 15 or newer. Confirm the stable HTTPS URL and that the hosting plan permits the intended use. Use Vercel deployment protection when available. Fictional staging can also use the application sign-in with a unique staging password. Set the Vercel project to Node 24 and retain its production alias for staging acceptance. Disable Git auto-deploys on this project so migration and release sequencing stay in the workflow.

## Provisioning

- Create a dedicated database, an owner or migration login, and a restricted login named `nexus_app`. In providers that require suffixes or alias usernames on pooled connections, use the provider connection string for the same restricted database role. Require TLS with provider certificate validation. Store runtime and migrations connections separately.
- Add `DATABASE_URL`, `NEXUS_RUNTIME_TARGET`, `BETTER_AUTH_URL` for the exact HTTPS alias, and a randomly generated `BETTER_AUTH_SECRET` to the Vercel production environment of the staging project. Better Auth stores sign-in rate counters in PostgreSQL and reads the client address supplied by the trusted Vercel proxy. Configure a provider-level limit for repeated authentication requests before institutional release.
- Create the GitHub environment `release-candidate` with authorized reviewers. Add secrets `VERCEL_TOKEN` and `MIGRATION_DATABASE_URL`. If Vercel deployment protection is enabled, also set `VERCEL_AUTOMATION_BYPASS_SECRET` for smoke tests. Add variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `RELEASE_URL`, `NEXUS_ACCEPTANCE_HOST` and `NEXUS_MIGRATION_TARGET`. Keep the migration credential out of Vercel application settings.
- After CI passes on main, dispatch **Deploy release candidate**. The workflow stamps the full Git SHA into the build, runs the SQL migrations, deploys to staging, and requires the staging alias to report that exact healthy revision before checking its sign-in page. Use a separate controlled account-provisioning step for test users.

## First-time account setup

1. In your managed PostgreSQL dashboard, create a project or database for fictional staging on PostgreSQL 15 or newer. In its connection and roles settings, create the separate owner/migration login and restricted `nexus_app` login. Confirm that `btree_gist` is available and that the migration login can create it. Use a direct or session connection for migrations because they hold a session advisory lock. A TLS-verified pooled endpoint is appropriate for the application's serverless connections. Confirm backups and the ability to restore into a separate database before acceptance.
2. In the authorized Vercel team, create the staging project. To avoid an initial automatic deployment, create an unlinked project with the Vercel CLI as the signed-in team owner using `vercel project add nexus-college-os-staging`. GitHub Actions supplies the checkout from this repository. Open the project in the Vercel dashboard and select **Settings → General** for Node.js 24, **Settings → Domains** for the stable HTTPS alias, and **Settings → Environment Variables** for the Production values `DATABASE_URL`, `NEXUS_RUNTIME_TARGET`, `BETTER_AUTH_URL`, and a generated `BETTER_AUTH_SECRET`. Vercel's Production environment here belongs to the dedicated fictional staging project. Find the team and project IDs under settings. Create the deploy token under your Vercel account's **Settings → Tokens** and scope it to the authorized team.
3. In the GitHub repository, open **Settings → Environments → New environment** and enter `release-candidate`. Allow only the `main` branch under **Deployment branches and tags**. Add the release secrets and variables listed under Provisioning. If Vercel deployment protection is enabled for the alias, create its automation bypass secret in **Settings → Deployment Protection** and store it as an additional GitHub environment secret. Use the hosting and GitHub settings to enter secrets.
4. Confirm setup by sharing the HTTPS alias and whether the project, database and environment are configured. The controlled release workflow and sign-in acceptance can then be run. Provision the fictional accounts through the existing seed command from an authorized environment with database access.

## Acceptance and recovery

Verify sign-in, scoped links, grade and notice publication, request handling, and denied access with approved fictional accounts. Re-deploy the same revision and confirm that prior records persist. Record the observed HTTPS URL and verification results in the test report. Use the Vercel deployment logs for application errors and monitor authenticated synthetic sign-ins separately from the public health status. The health endpoint returns 503 on database errors and excludes infrastructure details.

Enable managed backups and point-in-time recovery where the plan supports it. Before acceptance, restore to an isolated database and verify migrations, sign-in, representative workflow counts, and audit records. Establish an owner and recovery objectives with the product owner. To recover application service, restore a Vercel deployment compatible with the current database schema. Use a new forward migration for an incompatible database change, or an approved restore with a recorded data-loss window. Rehearse and record recovery before institutional data is authorized.

For a dedicated fictional release-candidate database, an authorized operator can set `NEXUS_DEMO_SEED=1`, `NEXUS_DEMO_DATABASE_HOST` to the exact migration URL hostname, and `NEXUS_DEMO_PASSWORD` to a unique staging-only secret of at least 24 characters. With the staging connection variables and auth configuration supplied securely, run `npm run db:seed` from the release checkout. The script checks for non-demo institutions and refuses to seed if present. Rerunning it retains existing account passwords. Keep the staging password in the team's secret manager.

## Authenticated acceptance

The release runner exercises the academic and service-request workflows over HTTP(S). Use Node 24, npm ci and Playwright Chromium on the operator machine. Keep the deployed source pinned to green main. Select the dedicated fictional staging origin via RELEASE_URL, confirm its exact host via NEXUS_ACCEPTANCE_HOST, set NEXUS_EXPECTED_REVISION to the full commit SHA recorded by the deployment, and load NEXUS_DEMO_PASSWORD from the staging secret manager. If protected, supply VERCEL_AUTOMATION_BYPASS_SECRET for a same-origin bypass-cookie handshake. The runner checks the healthy revision before sign-in and again after the journey. The protected-host handshake still needs hosted verification.

1. Record the deployed commit and alias, migration ledger names and checksums for the deployed revision, backup ID and the authorized fictional institution. Set NEXUS_ACCEPTANCE_RUN to a fresh unique identifier.
2. Run `npx tsx scripts/release-acceptance.ts exercise` from the integration checkout. It creates identifiable fictional academic and service-request records, signs in five roles and two unauthorized personas, checks private bytes and persisted results. Operate below the auth rate limit and allow its window to elapse between exercises. Failure can leave partial fictional records. Preserve them and use a new identifier for a fresh exercise.
3. Redeploy the same app revision. Run `npx tsx scripts/release-acceptance.ts verify` with the original run ID. This reads the existing workflow records and exercises authentication again.
4. Restore the managed backup into an isolated instance with separate credentials. Check audit and migration counts against the snapshot, point a separate staging app at the restored instance, and repeat verify there. Record downtime, lost-write window, log access, outcomes and recovery owner before acceptance.

### Running acceptance in GitHub Actions

After the hosted-acceptance workflow reaches main, select **Verify fictional staging workflows** on main. In the protected `release-candidate` environment set `NEXUS_ACCEPTANCE_HOST` to the staging hostname and `NEXUS_DEMO_PASSWORD` to the staging-only fictional password. Reuse the configured `RELEASE_URL` and optional deployment-protection bypass. Limit environment deployments to main. The acceptance job uses no database, model or Vercel management credentials. Its concurrency group serializes it with deployment.

Choose **exercise**, enter the deployed commit SHA and a fresh 8–64 character run ID to create the fictional records. After redeploying the same revision, choose **verify** with that SHA and run ID to reopen the records. A rerun of **exercise** requires a fresh ID. A verify run still creates login sessions. Record the Actions URLs, deployed revision and provider backup evidence. Use the operator runner above against a separately restored instance.

## Current release checkpoint

Main at `5af9797` passed GitHub CI. On November 23, 2026, a local exercise and two verification runs used a clean fictional seed and the same persisted run ID. The first verification followed a database restart. The second used a separate application process and PostgreSQL instance initialized from an offline copy of the stopped cluster. The migration ledger (12 names and checksums), audit count (8), attachment count (1) and resource booking count (0) matched before verification. The exercise covered faculty, student, administrator, HOD and principal workspaces, an unrelated section and a different tenant. The managed staging provider, protected HTTPS alias, redeployment, and provider-native backup restore still require hosted acceptance.

### Dedicated database allowlist

Before connecting, verify the project identity in the NEXUS provider dashboard. Set the password-free URI including scheme, username, host, port (when specified) and database path as NEXUS_RUNTIME_TARGET in Vercel, and NEXUS_MIGRATION_TARGET in the GitHub release-candidate environment variables. Obtain these allowlist entries independently of the secret URLs. Include any project suffix in a pooler username. Remote secret URLs must match the corresponding entry and use sslmode=verify-full. Use the provider CA through NODE_EXTRA_CA_CERTS when necessary. The runtime role must be nexus_app (or its project-qualified pooler name); verify its restricted grants at provisioning. Use both allowlists for the fictional seed runner. The configuration check validates endpoint identity; provider ownership, Data API settings, actual TLS, role privileges and backup policy require provider-side verification.

## SIT EEE pilot runbook

This section is for the real pilot after 2 December: the EEE department first (about 250 people), with live buses from drivers' phones. **Nothing here may start until**:
- the college has given written permission naming the data used and who is responsible;
- the founder has approved hosting spend, an email-sending account and a sending domain.

Until then, every environment uses fictional data, as AGENTS.md requires. No paid resource is created by this repository.

### Shape of the pilot deployment

| Part | Where | Notes |
| --- | --- | --- |
| Web app (pages, server actions, the driver-phone position endpoint) | Vercel project `nexus-college-os-pilot` (new, separate from fictional staging) | Node 24, region close to Mumbai. Disable Git auto-deploys; deploy only through the release workflow. Confirm the Vercel plan's terms allow this use. |
| Database | Managed PostgreSQL 15+ (Supabase in the founder's budget) in the Mumbai region | Separate project from fictional staging. Three logins: owner/migration, `nexus_app`, `nexus_worker`. TLS with certificate checking (`sslmode=verify-full`). |
| Background worker (inbox notices, reminders, digests) | One of the two options in `deploy/render-automation.example.yaml` (paid), or a scheduled `node --import tsx scripts/worker.ts --once` | The 5-minute bus alert must **not** depend on the worker. It is computed when a position arrives (codex/transport), and phone notifications are sent from that request. |
| Email sign-in codes | The provider the founder approves, through the adapter in cc/pilot-access | No email leaves the system before approval; local and tests use the console adapter. |

### Secrets and settings

- **Vercel, production environment of the pilot project:**
  - `DATABASE_URL` and `NEXUS_RUNTIME_TARGET`
  - `BETTER_AUTH_URL` (the exact HTTPS address) and a generated `BETTER_AUTH_SECRET`
  - `AURA_MODEL_ENABLED=false` (unless a key and cap are approved)
  - The email provider's key and sender address (names set by cc/pilot-access)
  - The phone-notification keys `NEXUS_PUSH_PUBLIC_KEY`, `NEXUS_PUSH_PRIVATE_KEY` and `NEXUS_PUSH_SUBJECT` (generated once; the private key never leaves Vercel)
- **GitHub environment `release-candidate` (or a new `pilot` environment with the same protections):** `MIGRATION_DATABASE_URL` and `NEXUS_MIGRATION_TARGET`. Keep the migration credential out of Vercel.
- **Worker host:** `WORKER_DATABASE_URL` and `NEXUS_WORKER_TARGET`.
- **Never** put secrets in the repository, the ledger or chat. Rotate `BETTER_AUTH_SECRET` and the push keys if they are ever exposed.

### First-time order

1. Create the database project and the three logins. Confirm `btree_gist` is available, then run the migrations through the release workflow (it holds the migration advisory lock).
2. **Do not run `npm run db:seed` or `npm run db:seed-demo` on the pilot database.** They create fictional people.
3. Create SIT's record once with `scripts/bootstrap-institution.ts` from an authorized machine, using the migration URL:
   - Run it first without `--apply`. Check the printed plan: the institution name, every department, only EEE switched on, and the office account.
   - Then rerun with `--apply`. It prints a one-time office password once; store it in the team's secret manager.
4. Deploy the web app and check `/api/health` reports the expected revision.
5. **Backup and restore test before any real person signs in:**
   - Enable the provider's daily backups; enable point-in-time recovery if the plan has it.
   - Take a backup, restore it into a separate project, point a separate deployment at it, and sign in as the office.
   - Record the backup ID, the time taken and the data-loss window in the ledger.
6. The office signs in and checks **Academic setup → Departments switched on**: only EEE is on.
7. The office imports EEE teachers from the college's sheet with a dry run first (cc/pilot-access). Teachers sign in by email code.
8. Students sign up and their section teachers approve them (cc/pilot-access). Each person accepts the privacy notice the college approved on first sign-in.
9. The transport office enters routes, stops, vehicles and schedules (codex/transport), then binds the driver phones (below).

### Binding a driver's phone

The driver's Android phone runs the free Traccar Client app. It reports positions with the screen locked. The exact server address and identifier format come from the endpoint in codex/transport; confirm them against that code before the first ride.
1. In NEXUS, the transport office opens the vehicle and creates a phone token. The token is shown once and bound to that vehicle only; a second token can be bound as a backup phone.
2. On the phone, install Traccar Client. Set the server URL to the NEXUS position endpoint, the device identifier to the token, the frequency to the value in `docs/TRANSPORT_ETA_DESIGN.md`, and allow location "all the time" and background data.
3. Start a trip in NEXUS, start the service in the app, and check that the bus appears on the route map within a minute.
4. **Lost or replaced phone:** revoke its token in NEXUS at once; its reports are refused from then on.

Positions are accepted only during an active trip and deleted after 7 days. No student's location is ever collected.

### Rolling back

- **Application:** use the hosting provider's instant rollback to the previous deployment, as long as it is compatible with the current database schema. Migrations only move forward. Fix a bad migration with a new forward migration, never by editing an applied one.
- **Data:** restore the latest backup into a new project, then switch the application to it. Record the data-loss window, and say what was lost to the affected people through the college contact.
- **If the app is down, the buses run as usual.** The college contact tells students through the usual channel. NEXUS is not a safety system.

### Daily during the pilot

- **Morning, before the first trip:** check health and each bus phone's last report time.
- **Evening:** read the ETA feedback and transport reports, and check that the 7-day position deletion ran. Record incidents and fixes in the ledger.
- **Widening to another department:** switch it on only after a clean week for EEE. Record the date and the reason.

## Android app (APK) and iPhone install (ID-016)

The app is the website installed on the device. Content and code updates come from the site, so the APK is built once per signing key and never rebuilt for a code change. Free tools only: no Play Store or Apple developer account.

### Android APK (Trusted Web Activity)
1. Deploy the site on its final HTTPS domain and check that `/manifest.webmanifest` and the icons load.
2. Build the APK with PWABuilder: go to pwabuilder.com, enter the site URL, choose Package for stores → Android → "Other Android". Or build it locally with Bubblewrap: `npx @bubblewrap/cli init --manifest https://<domain>/manifest.webmanifest`, then `build`. Choose a package name such as `org.<college>.collegeos`. Keep the generated signing key safe and private, never in Git.
3. Read the key's SHA-256 fingerprint. PWABuilder shows it; with Bubblewrap run `keytool -list -v -keystore android.keystore`.
4. On the web service, set `NEXUS_ANDROID_PACKAGE=<package name>` and `NEXUS_ANDROID_SHA256=<AA:BB:…>` (comma-separate several keys). `https://<domain>/.well-known/assetlinks.json` then answers; without both it returns 404. This file is what lets the APK open full screen with no browser bar.
5. Host the APK on an HTTPS link the college controls and set `NEXUS_ANDROID_APK_URL` to it. `/get-app` then shows the download.
6. On a test phone: install, open, confirm there is no address bar, sign in, and allow notifications.

### iPhone
No build is needed. Students open the site in Safari and choose Share → Add to Home Screen. Web push works only from the home-screen app (iOS 16.4 or later); in-app alerts remain the fallback. On an iPhone, `/get-app` shows these steps first.

### Install banner
In a browser tab, as opposed to the installed app, every page shows "Get NEXUS as an app" until the app is installed. "Not now" hides it for that visit only.

### WebKit test runs
`npx playwright test -c playwright.webkit.config.ts` runs the install, sign-in, join and mobile flows in WebKit at iPhone size. **Not yet run:** the cloud sandbox has only Chromium. Run it on a machine with Playwright's WebKit installed before the pilot.
