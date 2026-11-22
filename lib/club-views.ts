import { db } from "./db";
import { eligible } from "./clubverse";
import type { Scope } from "./scope";

export type Proposal = {
  id: string; founder_id: string; category_id: string; template_id: string | null; category: string;
  name: string; purpose: string; rules: string; joining: string; audience: string; state: string; revision: number; review_note: string | null;
};
const projection = "p.*, cat.label AS category";
const activeScope = `EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL)`;
const activeAudience = `(($3='student' AND p.audience<>'faculty') OR ($3='faculty' AND p.audience<>'students'))`;

export async function catalogOptions() {
  const [categories,templates] = await Promise.all([
    db.query<{ id: string; label: string }>("SELECT * FROM club_category ORDER BY label"),
    db.query<{ id: string; label: string; category_id: string }>("SELECT * FROM club_template ORDER BY label"),
  ]);
  return { categories: categories.rows, templates: templates.rows };
}

export async function clubs(scope: Scope, search: string, category: string) {
  const inputs = [scope.institution,scope.account,scope.role];
  const [recognized, proposals] = await Promise.all([
    db.query<Proposal & { club_state: string }>(
      `SELECT ${projection},c.state AS club_state FROM club c JOIN club_proposal p USING (institution_id,id)
       JOIN club_category cat ON cat.id=p.category_id WHERE c.institution_id=$1 AND ${activeScope}
       AND ($3='admin' OR (c.state='active' AND ${activeAudience}))
       AND ($4='' OR strpos(lower(p.name || ' ' || p.purpose),lower($4))>0) AND ($5='' OR cat.id=$5)
       ORDER BY p.name,p.id LIMIT 50`,[...inputs,search,category],
    ),
    db.query<Proposal>(
      `SELECT ${projection} FROM club_proposal p JOIN club_category cat ON cat.id=p.category_id
       WHERE p.institution_id=$1 AND ${activeScope} AND p.state<>'approved'
       AND ((p.founder_id=$2 AND ${activeAudience}) OR ($3='admin' AND p.state IN ('submitted','under_review','rejected')))
       ORDER BY p.created_at DESC,p.id LIMIT 50`,inputs,
    ),
  ]);
  return { recognized: recognized.rows, proposals: proposals.rows };
}

export type ClubEvent = { id: string; title: string; author_id: string; location: string; requirements: string; audience: string;
  starts_at: Date; ends_at: Date; state: string; capacity: number; revision: number; registered: boolean; verified: boolean; total: number; attended: number };
type Person = { account_id: string; name: string; state: string };
type Registration = { event_id: string; account_id: string; name: string; verified_at: Date | null; evidence: string | null };

export async function clubView(scope: Scope, id: string, selection?: { event: string; page: number }) {
  const key = [scope.institution,scope.account,scope.role,id];
  const { rows: [club] } = await db.query<Proposal & { club_state: string; member_state: string | null; kinds: string[]; timezone: string; lead_id: string | null }>(
    `SELECT ${projection},c.state AS club_state,i.timezone,m.state AS member_state,
       (SELECT leader.account_id FROM club_grant leader WHERE (leader.institution_id,leader.club_id)=(c.institution_id,c.id)
         AND leader.kind='lead' AND leader.ended_at IS NULL) AS lead_id,ARRAY(
       SELECT g.kind FROM club_grant g WHERE (g.institution_id,g.club_id,g.account_id)=(c.institution_id,c.id,$2) AND g.ended_at IS NULL
     ) AS kinds FROM club c JOIN club_proposal p USING (institution_id,id)
     JOIN institution i ON i.id=c.institution_id JOIN club_category cat ON cat.id=p.category_id
     LEFT JOIN club_member m ON (m.institution_id,m.club_id,m.account_id)=(c.institution_id,c.id,$2)
     WHERE c.institution_id=$1 AND c.id=$4 AND ${activeScope} AND ($3='admin' OR (c.state='active' AND ${activeAudience}))`,key,
  );
  if (!club) return null;
  const member = club.club_state === "active" && eligible(club.audience,scope.role) && club.member_state === "active";
  const lead = member && club.kinds.includes("lead");
  const officer = lead || (member && club.kinds.includes("officer"));
  const admin = scope.role === "admin";
  const clubKey = [scope.institution,id];
  const [events,people,grants,candidates,handovers] = await Promise.all([
    db.query<ClubEvent>(`
      SELECT e.*, (mine.account_id IS NOT NULL) AS registered,(mine.verified_at IS NOT NULL) AS verified,
        result.total,result.attended FROM club_event e
      LEFT JOIN club_registration mine ON (mine.institution_id,mine.event_id,mine.account_id)=(e.institution_id,e.id,$3)
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS total,count(verified_at)::int AS attended FROM club_registration r
        WHERE (r.institution_id,r.event_id)=(e.institution_id,e.id)
      ) result ON $4 OR e.state='completed'
      WHERE (e.institution_id,e.club_id)=($1,$2)
        AND ($4 OR ($5 AND e.state IN ('pending_approval','approved')) OR
          (e.published_at IS NOT NULL AND e.state IN ('published','registration_open','registration_closed','in_progress','completed','cancelled')
           AND (e.audience='eligible' OR $6)))
      ORDER BY e.starts_at,e.id LIMIT 50`,[...clubKey,scope.account,officer,admin,member]),
    officer ? db.query<Person>(
      `SELECT m.account_id,m.state,u.name FROM club_member m JOIN "user" u ON u.id=m.account_id
       WHERE (m.institution_id,m.club_id)=($1,$2) ORDER BY u.name,m.account_id LIMIT 200`,clubKey,
    ) : null,
    lead ? db.query<{ id: string; kind: string; name: string }>(
      `SELECT g.id,g.kind,u.name FROM club_grant g JOIN "user" u ON u.id=g.account_id
       WHERE (g.institution_id,g.club_id)=($1,$2) AND g.kind<>'lead' AND g.ended_at IS NULL ORDER BY u.name LIMIT 200`,clubKey,
    ) : null,
    officer && club.joining === "invitation" ? db.query<Person>(
      `SELECT DISTINCT u.id AS account_id,u.name,'eligible' AS state FROM membership m JOIN "user" u ON u.id=m.account_id
       WHERE m.institution_id=$1 AND m.ended_at IS NULL AND
         ((m.role='student' AND $3<>'faculty') OR (m.role='faculty' AND $3<>'students'))
       AND NOT EXISTS (SELECT 1 FROM club_member cm WHERE (cm.institution_id,cm.club_id,cm.account_id)=($1,$2,u.id)
         AND cm.state IN ('requested','active','invited')) ORDER BY u.name LIMIT 100`,[...clubKey,club.audience],
    ) : null,
    admin || lead ? db.query<{ id: string; notes: string; name: string; approved_at: Date | null; cancelled_at: Date | null }>(
      `SELECT h.id,h.notes,u.name,h.approved_at,h.cancelled_at FROM club_handover h JOIN "user" u ON u.id=h.incoming_id
       WHERE (h.institution_id,h.club_id)=($1,$2) ORDER BY COALESCE(h.approved_at,h.cancelled_at) DESC NULLS FIRST LIMIT 20`,clubKey,
    ) : null,
  ]);
  const participantEvent = officer
    ? (selection ? events.rows.find(event => event.id === selection.event) : events.rows.find(event => event.total > 0))?.id
    : undefined;
  const participantPage = selection?.page ?? 0;
  const registrations = participantEvent ? (await db.query<Registration>(
    `SELECT r.event_id,r.account_id,u.name,r.verified_at,r.evidence FROM club_registration r JOIN "user" u ON u.id=r.account_id
     WHERE (r.institution_id,r.event_id)=($1,$2) ORDER BY u.name,u.id LIMIT 51 OFFSET $3`,
    [scope.institution,participantEvent,participantPage*50],
  )).rows : [];
  return { club, member, lead, officer, events:events.rows, people:people?.rows ?? [], grants:grants?.rows ?? [],
    candidates:candidates?.rows ?? [], registrations:registrations.slice(0,50), participantEvent, participantPage,
    moreParticipants:registrations.length>50, handovers:handovers?.rows ?? [] };
}
