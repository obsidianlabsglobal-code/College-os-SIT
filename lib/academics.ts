import { db, transaction } from "./db";
import { WorkflowError, audit } from "./assignments";
import type { Scope } from "./scope";

type Option = { id: string; name: string };
type RosterEntry = { offering_id: string; account_id: string; role: "faculty" | "student"; person: string; offering: string; ended_at: Date | null };

export async function adminCatalog(scope: Scope) {
  if (scope.role !== "admin") throw new WorkflowError("This action is unavailable.");
  const values = [scope.institution, scope.account];
  const allowed = "EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL)";
  const catalog = (table: "department" | "course" | "section" | "academic_term") =>
    db.query<Option>(`SELECT id,name FROM ${table} WHERE institution_id=$1 AND ${allowed} ORDER BY name,id`, values);
  const [departments, courses, sections, terms, offerings, people, roster] = await Promise.all([
    catalog("department"), catalog("course"), catalog("section"), catalog("academic_term"),
    db.query<Option>(`SELECT o.id,c.name || ' · ' || s.name || ' · ' || t.name AS name FROM offering o
     JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
     JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
     JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
     WHERE o.institution_id=$1 AND ${allowed} ORDER BY name,o.id`,values),
    db.query<Option & { role: "faculty" | "student" }>(`SELECT u.id,u.name,m.role FROM membership m JOIN "user" u ON u.id=m.account_id
     WHERE m.institution_id=$1 AND m.role IN ('faculty','student') AND m.ended_at IS NULL AND ${allowed} ORDER BY u.name,m.role`,values),
    db.query<RosterEntry>(`SELECT r.offering_id,r.account_id,r.role,u.name AS person,
     c.name || ' · ' || s.name || ' · ' || t.name AS offering,r.ended_at
     FROM roster r JOIN "user" u ON u.id=r.account_id
     JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
     JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
     JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
     JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
     WHERE r.institution_id=$1 AND ${allowed} ORDER BY offering,person,r.role`, values),
  ] as const);
  return { departments: departments.rows, courses: courses.rows, sections: sections.rows, terms: terms.rows,
    offerings: offerings.rows, people: people.rows, roster: roster.rows };
}

type Change =
  | { operation: "course"; name: string; department: string }
  | { operation: "section"; name: string }
  | { operation: "offering"; course: string; section: string; term: string }
  | { operation: "add-roster" | "end-roster"; offering: string; account: string; role: "faculty" | "student" };

export async function changeCatalog(scope: Scope, change: Change) {
  if (scope.role !== "admin") throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    const tenant = scope.institution;
    const admin = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE", [tenant,scope.account]);
    if (!admin.rowCount) throw new WorkflowError("This action is unavailable.");
    let result;
    switch (change.operation) {
      case "course":
        result = await client.query<{ id: string }>("INSERT INTO course (institution_id,department_id,name) VALUES ($1,$2,$3) RETURNING id", [tenant,change.department,change.name]);
        break;
      case "section":
        result = await client.query<{ id: string }>("INSERT INTO section (institution_id,name) VALUES ($1,$2) RETURNING id", [tenant,change.name]);
        break;
      case "offering":
        result = await client.query<{ id: string }>("INSERT INTO offering (institution_id,course_id,section_id,term_id) VALUES ($1,$2,$3,$4) RETURNING id", [tenant,change.course,change.section,change.term]);
        break;
      case "add-roster":
        result = await client.query<{ id: string }>(
          `INSERT INTO roster (institution_id,offering_id,account_id,role)
           SELECT institution_id,$2,account_id,role FROM membership WHERE institution_id=$1 AND account_id=$3 AND role=$4 AND ended_at IS NULL
           ON CONFLICT (institution_id,offering_id,account_id,role) DO UPDATE SET ended_at=NULL
           WHERE roster.ended_at IS NOT NULL RETURNING offering_id AS id`, [tenant,change.offering,change.account,change.role],
        );
        break;
      case "end-roster":
        result = await client.query<{ id: string }>(
          "UPDATE roster SET ended_at=clock_timestamp() WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role=$4 AND ended_at IS NULL RETURNING offering_id AS id",
          [tenant,change.offering,change.account,change.role],
        );
        break;
    }
    const [record] = result.rows;
    if (!record) throw new WorkflowError("No change was made. Check the current roster.");
    await audit(client,scope,record.id,`academic.${change.operation}`);
  });
}
