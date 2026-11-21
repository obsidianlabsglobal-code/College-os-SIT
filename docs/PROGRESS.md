# Progress

## November 21, 2026

- Implemented Release 1 application code for five role workspaces, academic administration, assignments and feedback, notices, enrollment-letter requests, and scoped reporting. PostgreSQL persists workflow state and mutation audits.
- Verified production compilation, restricted runtime database permissions, clean migrations with a repeat run, and local PostgreSQL persistence after restart. The PostgreSQL integration and Chromium release journeys passed with fictional accounts. See the test report for exact coverage.
- Prepared a GitHub Actions verification workflow and a manually dispatched Vercel release-candidate workflow. Vercel with managed PostgreSQL was selected by the product owner. The GitHub repository lists no release environment. A Vercel project, release alias, protected access, and database connections are required for hosted verification.
- User validation, official SIT authorization, hosted backups, restore rehearsal, storage scanning, and institutional privacy and academic policy verification remain open. The first release uses fictional accounts until those gates are met.
- Next release work is protected staging deployment, a hosted acceptance run, and recovery rehearsal. Release 1.1 starts after the first release is stable.
