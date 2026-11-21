import { db, transaction } from "./db";
import { audit, WorkflowError } from "./assignments";
import type { Scope } from "./scope";

export const delegatedRoles = ["student","faculty","hod","principal"] as const;
type DelegatedRole = (typeof delegatedRoles)[number];
type InstitutionChange =
  | { operation: "department" | "scheme"; name: string }
  | { operation: "term"; name: string; scheme: string }
  | { operation: "grant"; account: string; role: DelegatedRole; department?: string }
  | { operation: "end"; membership: string };

export async function institutionCatalog(current: Scope) {
  if (current.role !== "admin") throw new WorkflowError("This action is unavailable.");
  const parameters = [current.institution,current.account];
  const allowed = "EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL)";
  const [schemes,grants] = await Promise.all([
    db.query<{ id: string; name: string }>(`SELECT id,name FROM academic_scheme WHERE institution_id=$1 AND ${allowed} ORDER BY name`,parameters),
    db.query<{ id: string; account_id: string; account_name: string; department: string | null; role: string; ended_at: Date | null }>(
      `SELECT m.id,m.account_id,u.name AS account_name,d.name AS department,m.role,m.ended_at
       FROM membership m JOIN "user" u ON u.id=m.account_id
       LEFT JOIN department d ON (d.institution_id,d.id)=(m.institution_id,m.department_id)
       WHERE m.institution_id=$1 AND ${allowed} ORDER BY u.name,m.role,d.name`,parameters),
  ]);
  return { schemes: schemes.rows, grants: grants.rows };
}

export async function changeInstitution(current: Scope, input: InstitutionChange) {
  if (current.role !== "admin") throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    const institution = current.institution;
    const admin = await client.query(
      "SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [institution,current.account],
    );
    if (!admin.rowCount) throw new WorkflowError("This action is unavailable.");
    let result;
    switch (input.operation) {
      case "department":
      case "scheme": {
        const table = input.operation === "department" ? "department" : "academic_scheme";
        result = await client.query<{ id: string }>(`INSERT INTO ${table} (institution_id,name) VALUES ($1,$2) RETURNING id`,[institution,input.name]);
        break;
      }
      case "term":
        result = await client.query<{ id: string }>("INSERT INTO academic_term (institution_id,scheme_id,name) VALUES ($1,$2,$3) RETURNING id",[institution,input.scheme,input.name]);
        break;
      case "grant":
        if (input.role === "hod" && !input.department) throw new WorkflowError("Select a department for the HOD role.");
        result = await client.query<{ id: string }>(
          `INSERT INTO membership (institution_id,account_id,role,department_id)
           SELECT $1,$2,$3,$4 WHERE EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2)
           ON CONFLICT (institution_id,account_id,role,department_id) DO UPDATE SET ended_at=NULL
           WHERE membership.ended_at IS NOT NULL RETURNING id`,
          [institution,input.account,input.role,input.role === "hod" ? input.department : null],
        );
        break;
      case "end":
        result = await client.query<{ id: string }>(
          "UPDATE membership SET ended_at=clock_timestamp() WHERE institution_id=$1 AND id=$2 AND role<>'admin' AND ended_at IS NULL RETURNING id",
          [institution,input.membership],
        );
        break;
    }
    const [changed] = result.rows;
    if (!changed) throw new WorkflowError("No change was made. Check the current assignments.");
    await audit(client,current,changed.id,`institution.${input.operation}`);
  });
}
