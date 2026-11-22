# NEXUS product roadmap

The eight connected domains are Student Life, Faculty Intelligence, Department, Institutional Leadership, Administration and Staff, Smart Campus and Transport, Careers/Research/Opportunity, and CLUBVERSE. They share accounts, institution membership, domain authorization, audit records and experience standards.

Release 1 stays on main and targets fictional-data HTTPS staging before December 2 IST. The account owner must authorize a Vercel project and managed PostgreSQL. Set Vercel runtime variables and the GitHub release environment in [Deployment](DEPLOYMENT.md). Then validate the hosted revision, fictional journeys, isolation, data persistence and restoration. No release environment or deployment was visible at the November 22 branch check.

Experiences and transport are tracked in [Experience roadmap](EXPERIENCE_ROADMAP.md). CLUBVERSE is developed on its own branch over the verified experience shell. AURA uses separate development and consumes tested domain services. Long-term innovations retain the existing hypotheses and experiments in [Innovation lab](INNOVATION_LAB.md). No approved model, fleet integration or SIT record-processing authority was available.

## November 22 implementation evidence

CLUBVERSE core passed GitHub CI run 44998619503 on its separate feature branch. AURA adds the deterministic event draft journey on a dependent branch. The combined local run passed migration, lint, type check, build, nine PostgreSQL tests, and seven Chromium tests. Chromium captured the fictional directory at 390 px and organizer and AURA activity at 1440 px. These are development and automated browser results. Hosted, model-provider, and institutional user acceptance remain open.

The [master registry](NEXUS_MASTER_FEATURE_REGISTRY.md) owns feature status. The [dependency roadmap](NEXUS_IMPLEMENTATION_DEPENDENCIES.md) owns cross-domain sequencing and release gates.
