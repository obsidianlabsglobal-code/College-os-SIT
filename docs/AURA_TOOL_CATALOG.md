# AURA tools

The executable catalog in lib/aura/capabilities.ts declares tool versions, roles, domain services, permission scopes, schemas, risk, admission limits, SQL statement timeout, approval and verification behavior. Model interpretation is a separate, opt-in step. Executing a catalog read makes zero model calls.

Students can ask for pending work, assignments, published feedback, attendance, current or next class, timetable, notices, requests and visible clubs. Faculty have their assigned timetable, current or next class, evaluation queue, assignments, notices and clubs. Pending student work includes only open assignments without a submission. Next class includes a published class in progress and otherwise returns the next published class. Both return a link to the authorized source record. Opening read history resolves current grants again.

The CLUBVERSE planner uses the event input schema and the current officer grant. Preparing a preview yields a task reference; owner confirmation through decideEventPlan saves the private event draft and returns its persistent ID. Official publication remains a separate human workflow. Agent admission is bounded separately from the database statement timeout. End-to-end latency and provider billing require deployment measurements.
