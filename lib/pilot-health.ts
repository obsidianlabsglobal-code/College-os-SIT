import { db } from "./db";
import { NOTICE } from "./consent";
import type { Scope } from "./scope";

// Office view of how the pilot is going: who is waiting, who has not accepted the notice, who cannot sign in, and how
// many phones get bus alerts. Failed sign-ins are shown only for emails that belong to this college's members or requests.
export async function pilotHealth(scope: Scope) {
  if (scope.role !== "admin") return null;
  const params = [scope.institution, scope.account];
  const admin = `EXISTS (SELECT 1 FROM membership a WHERE a.institution_id=$1 AND a.account_id=$2 AND a.role='admin' AND a.ended_at IS NULL)`;
  const ours = `(SELECT lower(u.email) FROM "user" u WHERE u.id IN (SELECT account_id FROM membership WHERE institution_id=$1
      UNION SELECT account_id FROM signup_request WHERE institution_id=$1))`;
  const [people, pending, consent, failures, phones, departments] = await Promise.all([
    db.query<{ role: string; n: number }>(`SELECT m.role,count(DISTINCT m.account_id)::int AS n FROM membership m WHERE m.institution_id=$1 AND m.ended_at IS NULL AND ${admin}
      GROUP BY m.role ORDER BY m.role`, params),
    db.query<{ section: string; waiting: number; oldest_hours: number }>(`SELECT s.name AS section,count(*)::int AS waiting,
        floor(extract(epoch FROM clock_timestamp()-min(r.created_at))/3600)::int AS oldest_hours
      FROM signup_request r JOIN section s ON (s.institution_id,s.id)=(r.institution_id,r.section_id)
      WHERE r.institution_id=$1 AND r.state='pending' AND ${admin} GROUP BY s.name ORDER BY waiting DESC,s.name`, params),
    db.query<{ required: boolean; members: number; accepted: number }>(`SELECT i.consent_required AS required,
        (SELECT count(DISTINCT m.account_id)::int FROM membership m WHERE m.institution_id=$1 AND m.ended_at IS NULL) AS members,
        (SELECT count(DISTINCT c.account_id)::int FROM consent_record c JOIN membership m ON m.institution_id=c.institution_id AND m.account_id=c.account_id AND m.ended_at IS NULL
          WHERE c.institution_id=$1 AND c.notice_version=$3) AS accepted
      FROM institution i WHERE i.id=$1 AND ${admin}`, [...params, NOTICE.version]),
    db.query<{ email: string; failures: number; last: Date }>(`SELECT f.email,count(*)::int AS failures,max(f.failed_at) AS last FROM sign_in_failure f
      WHERE f.failed_at > clock_timestamp()-interval '24 hours' AND f.email IN ${ours} AND ${admin}
      GROUP BY f.email ORDER BY failures DESC,f.email LIMIT 50`, params),
    db.query<{ phones: number; people: number }>(`SELECT count(*)::int AS phones,count(DISTINCT account_id)::int AS people FROM push_subscription
      WHERE institution_id=$1 AND ${admin}`, params),
    db.query<{ name: string; active: boolean }>(`SELECT name,active FROM department WHERE institution_id=$1 AND ${admin} ORDER BY name`, params),
  ]);
  if (!consent.rows[0]) return null;
  return { people: people.rows, pending: pending.rows, consent: consent.rows[0], failures: failures.rows, phones: phones.rows[0], departments: departments.rows };
}
