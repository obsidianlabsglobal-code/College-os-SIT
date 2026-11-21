# Fictional demonstration

After following local setup, sign in with an address in the form `<alias>@nexus.example.invalid` and the local-only password in `scripts/fixtures.ts`. All fixtures are fictional. Use a clean local database when comparing exact counts.

1. Sign in as `faculty`. Create a programming assignment for Section A with a future Asia/Kolkata deadline. Publish it.
2. Sign in as `student`. Open it and submit text or a permitted file. The submission is final.
3. Return as `faculty`. Enter marks and feedback and save the draft. Check as `student` that feedback is pending. Publish as `faculty`.
4. Return as `student` and confirm the published result. Publish a correction with a reason and confirm that the latest result appears.
5. Sign in as `hod` and inspect the department's actual counts. Inspect institution-level counts as `principal`.
6. As `faculty`, publish a course notice. Check it as `student` and confirm it stays unavailable to `outsider` in the other section.
7. As `student`, request an enrollment letter. As `admin`, start review and record an outcome. Return as `student` to confirm the resolution.
8. As `admin`, use Academic setup and roles to view the existing catalog, role assignments and course rosters. As `tenant`, confirm that records from the first institution are unavailable.
