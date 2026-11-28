import { db, transaction } from "./db";
import { audit, WorkflowError } from "./assignments";
import type { Scope } from "./scope";

// SA-002: the institution's course catalog for any active member. Offerings the office hides are listed only to admins
// and to people on their roster. Shows course, department, term, section and the
// current teacher only; rosters and records stay with their own read models. `mine` marks the caller's own rosters.
export type CatalogEntry = { department: string; course: string; offering: string; term: string; scheme: string; section: string;
  faculty: string[]; mine: boolean; visible: boolean };

export async function courseCatalog(scope: Scope, search = "") {
  return (await db.query<CatalogEntry>(`SELECT d.name AS department,c.name AS course,o.id AS offering,t.name AS term,sc.name AS scheme,s.name AS section,
      coalesce(array_agg(DISTINCT u.name ORDER BY u.name) FILTER (WHERE f.account_id IS NOT NULL),'{}') AS faculty,
      bool_or(mine.account_id IS NOT NULL) AS mine,o.catalog_visible AS visible
    FROM offering o
    JOIN membership m ON m.institution_id=o.institution_id AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN department d ON (d.institution_id,d.id)=(c.institution_id,c.department_id)
    JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
    JOIN academic_scheme sc ON (sc.institution_id,sc.id)=(t.institution_id,t.scheme_id)
    LEFT JOIN roster f ON (f.institution_id,f.offering_id)=(o.institution_id,o.id) AND f.role='faculty' AND f.ended_at IS NULL
    LEFT JOIN "user" u ON u.id=f.account_id
    LEFT JOIN roster mine ON (mine.institution_id,mine.offering_id)=(o.institution_id,o.id) AND mine.account_id=$2 AND mine.role=$3 AND mine.ended_at IS NULL
    WHERE o.institution_id=$1 AND (o.catalog_visible OR $3='admin' OR mine.account_id IS NOT NULL) AND ($4='' OR c.name ILIKE '%'||$4||'%' OR d.name ILIKE '%'||$4||'%')
    GROUP BY d.name,c.name,o.id,o.catalog_visible,t.name,sc.name,s.name ORDER BY d.name,c.name,t.name,s.name LIMIT 500`,
  [scope.institution, scope.account, scope.role, search.replace(/[%_\\]/g, "").slice(0, 80)])).rows;
}

/** Office: show or hide an offering in the catalog. Rosters and records are unaffected. */
export function setCatalogVisibility(scope: Scope, offering: string, visible: boolean) {
  if (scope.role !== "admin" || !/^[0-9a-f-]{36}$/i.test(offering)) throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE offering SET catalog_visible=$3 WHERE institution_id=$1 AND id=$2 AND catalog_visible<>$3
      AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$4 AND role='admin' AND ended_at IS NULL)`, [scope.institution, offering, visible, scope.account]);
    if (!rowCount) throw new WorkflowError("No change was made.");
    await audit(client, scope, offering, visible ? "catalog.shown" : "catalog.hidden");
  });
}
