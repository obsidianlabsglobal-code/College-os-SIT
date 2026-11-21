# Product requirements

- Students see their enrolled offerings' published assignments, submit once on time, and see explicitly published feedback. They can read relevant notices and track their own enrollment-letter requests.
- Faculty can draft and publish assignments and notices for their active offerings, review submitted work, and publish validated grades. Corrections require an explanation and publication.
- HODs can publish department notices and inspect aggregate activity in departments they lead. Principals can review institution-wide aggregates and published notices.
- Institution administrators can manage departments, schemes, terms, course offerings, and rosters. They can grant and end delegated roles for people already provisioned in their institution, publish institution notices, and process enrollment-letter requests.
- Every mutation validates scope on the server and writes an audit event. Closing an enrollment-letter request records the decision and outcome. Letter issuance takes place through the academic office.
- Parent access requires a verified consent and authorization policy. The intended design uses a separately revocable grant tied to a relationship and defined record scope.

Acceptance requires the assignment, notice and request journeys against persisted records, working role-specific views, passing negative checks, an HTTPS release candidate and a recorded recovery plan.
