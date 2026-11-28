import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { clubAccess, lockClubActor } from "./clubverse";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// CL-028. Only a current lead or officer of an active club posts or withdraws; expiry is a college-local date.
const unavailable = () => new WorkflowError("This CLUBVERSE action is unavailable.");
const postInput = z.object({ club: z.uuid(), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4000),
  audience: z.enum(["members", "eligible"]), expires: z.iso.date() });

export function postClubNotice(scope: Scope, raw: unknown) {
  const input = postInput.parse(raw);
  return transaction(async client => {
    await lockClubActor(client, scope);
    const access = await clubAccess(client, scope, input.club);
    if (access.state !== "active" || !access.officer) throw unavailable();
    const { rows: [n] } = await client.query<{ id: string }>(`INSERT INTO club_notice (institution_id,club_id,author_id,audience,title,body,expires_on)
      SELECT $1,$2,$3,$4,$5,$6,$7::date FROM institution i WHERE i.id=$1
        AND $7::date BETWEEN (clock_timestamp() AT TIME ZONE i.timezone)::date AND (clock_timestamp() AT TIME ZONE i.timezone)::date+180
      RETURNING id`, [scope.institution, input.club, scope.account, input.audience, input.title, input.body, input.expires]);
    if (!n) throw new WorkflowError("Choose an expiry date from today up to 180 days ahead.");
    await audit(client, scope, n.id, "club.notice_published");
    return n.id;
  });
}

export function withdrawClubNotice(scope: Scope, raw: unknown) {
  const input = z.object({ club: z.uuid(), notice: z.uuid() }).parse(raw);
  return transaction(async client => {
    await lockClubActor(client, scope);
    const access = await clubAccess(client, scope, input.club);
    if (!access.officer) throw unavailable();
    const done = await client.query(`UPDATE club_notice SET withdrawn_at=clock_timestamp()
      WHERE institution_id=$1 AND club_id=$2 AND id=$3 AND withdrawn_at IS NULL`, [scope.institution, input.club, input.notice]);
    if (!done.rowCount) throw new WorkflowError("This notice is already withdrawn.");
    await audit(client, scope, input.notice, "club.notice_withdrawn");
  });
}

export type ClubNotice = { id: string; title: string; body: string; audience: string; published_at: Date; expires_on: string; author: string };
/** Current notices: members (and officers) see both audiences; others eligible for an active club see 'eligible' notices. */
export async function clubNotices(scope: Scope, club: string) {
  if (scope.role !== "student" && scope.role !== "faculty") return [];
  return (await db.query<ClubNotice>(`SELECT n.id,n.title,n.body,n.audience,n.published_at,to_char(n.expires_on,'YYYY-MM-DD') AS expires_on,u.name AS author
    FROM club_notice n JOIN club c ON (c.institution_id,c.id)=(n.institution_id,n.club_id) AND c.state='active'
    JOIN club_proposal p ON (p.institution_id,p.id)=(c.institution_id,c.id)
    JOIN institution i ON i.id=n.institution_id JOIN "user" u ON u.id=n.author_id
    JOIN membership m ON m.institution_id=n.institution_id AND m.account_id=$3 AND m.role=$4 AND m.ended_at IS NULL
    WHERE n.institution_id=$1 AND n.club_id=$2 AND n.withdrawn_at IS NULL
      AND n.expires_on >= (clock_timestamp() AT TIME ZONE i.timezone)::date
      AND ((p.audience<>'faculty' AND $4='student') OR (p.audience<>'students' AND $4='faculty'))
      AND (n.audience='eligible' OR EXISTS (SELECT 1 FROM club_member cm WHERE (cm.institution_id,cm.club_id,cm.account_id)=(n.institution_id,n.club_id,$3) AND cm.state='active'))
    ORDER BY n.published_at DESC LIMIT 20`, [scope.institution, club, scope.account, scope.role])).rows;
}
