// Deterministic projections only. The controller must load and lock authorized persisted records
// before using these helpers; nothing here verifies a session or sends a notification.
type Incident = { institution:string; trip:string; id:string; status:"open"|"resolved"; updateBy:string|null; missingUpdateWarningKey:string|null };
type Receipt = { institution:string; trip:string; incident:string; recipient:string; locale:"en"|"kn"; audience:"waiting"|"aboard" };

export function promisedUpdateWarning(incident:Incident, now:Date) {
  if (incident.status!=="open" || !incident.updateBy) return null;
  const due=Date.parse(incident.updateBy);
  if (!Number.isFinite(due) || now.getTime()<due) return null;
  const key=`${incident.institution}:${incident.id}:${new Date(due).toISOString()}`;
  return incident.missingUpdateWarningKey===key ? null : {key, dueAt:new Date(due).toISOString()};
}
export function allClearRecipients(incident:Incident, previouslyNotified:readonly Receipt[]) {
  if (incident.status!=="resolved") return [];
  const deduped = new Map<string,Receipt>();
  // Query receipts in order of successful publication; the most recent variant wins.
  for(const r of previouslyNotified) if(r.institution===incident.institution && r.trip===incident.trip && r.incident===incident.id)
    deduped.set(r.recipient,r);
  return [...deduped.values()];
}
type DelayEvidence = { institution:string; trip:string; serviceDay:string; student:string; confirmedAffected:boolean };
type CandidatePeriod = { institution:string; serviceDay:string; student:string; periodNumber:number; status:"late"|"present"|"absent"|"unrecorded"; manuallyDecided:boolean };
export function busDelayAnnotation(incident:Incident, day:string, verifiedRiderEvidence:DelayEvidence, period:CandidatePeriod) {
  const e=verifiedRiderEvidence;
  return e.confirmedAffected && e.institution===incident.institution && e.trip===incident.trip && e.serviceDay===day &&
    (period.institution===e.institution && period.student===e.student && period.serviceDay===day) &&
    period.periodNumber===1 && period.status==="late" && !period.manuallyDecided
    ? {student:period.student, day, reason:"bus_delay" as const, incident:incident.id}
    : null;
}
