import { z } from "zod";
import { audit, createAssignment, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// FC-009: a teacher's versioned question bank, private or shared with a department they teach in.
// FC-008 slice: compose a draft assignment from selected questions; the draft cites each question's version.
const unavailable = () => new WorkflowError("This action is unavailable.");
const teachesIn = `SELECT DISTINCT c.department_id FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
  JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
  JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='faculty' AND m.ended_at IS NULL
  WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL`;

export type BankQuestion = { id: string; topic: string; visibility: "private" | "department"; owner: string; mine: boolean; department: string;
  version: number; prompt: string; marks: number };

/** Own questions, and department-shared questions in departments the caller currently teaches in. */
export async function bankQuestions(scope: Scope) {
  if (scope.role !== "faculty") return [];
  return (await db.query<BankQuestion>(`SELECT q.id,q.topic,q.visibility,u.name AS owner,q.owner_id=$2 AS mine,d.name AS department,v.version,v.prompt,v.marks
    FROM bank_question q JOIN "user" u ON u.id=q.owner_id JOIN department d ON (d.institution_id,d.id)=(q.institution_id,q.department_id)
    JOIN LATERAL (SELECT version,prompt,marks FROM bank_question_version x WHERE (x.institution_id,x.question_id)=(q.institution_id,q.id) ORDER BY version DESC LIMIT 1) v ON true
    WHERE q.institution_id=$1 AND q.department_id IN (${teachesIn}) AND (q.owner_id=$2 OR q.visibility='department')
    ORDER BY q.topic,q.id`, [scope.institution, scope.account])).rows;
}

export async function bankDepartments(scope: Scope) {
  if (scope.role !== "faculty") return [];
  return (await db.query<{ id: string; name: string }>(`SELECT d.id,d.name FROM department d WHERE d.institution_id=$1 AND d.id IN (${teachesIn}) ORDER BY d.name`,
    [scope.institution, scope.account])).rows;
}

const saveInput = z.object({ question: z.uuid().optional(), department: z.uuid().optional(), topic: z.string().trim().min(1).max(120).optional(),
  visibility: z.enum(["private", "department"]).optional(), prompt: z.string().trim().min(1).max(4000), marks: z.coerce.number().int().min(1).max(100) });
/** Create a question, or add a new version of one you own. Earlier versions stay as they were. */
export function saveQuestion(scope: Scope, raw: unknown) {
  const input = saveInput.parse(raw);
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    let id = input.question;
    if (id) {
      const { rowCount } = await client.query(`SELECT 1 FROM bank_question WHERE institution_id=$1 AND id=$3 AND owner_id=$2 AND department_id IN (${teachesIn}) FOR UPDATE`,
        [scope.institution, scope.account, id]);
      if (!rowCount) throw unavailable();
      if (input.visibility) await client.query("UPDATE bank_question SET visibility=$3 WHERE institution_id=$1 AND id=$2", [scope.institution, id, input.visibility]);
    } else {
      if (!input.department || !input.topic) throw new WorkflowError("Choose a department and enter a topic.");
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO bank_question (institution_id,owner_id,department_id,topic,visibility)
        SELECT $1,$2,$3,$4,$5 WHERE $3::uuid IN (${teachesIn}) RETURNING id`,
      [scope.institution, scope.account, input.department, input.topic, input.visibility ?? "private"]);
      if (!row) throw new WorkflowError("Choose a department you currently teach in.");
      id = row.id;
    }
    const { rows: [v] } = await client.query<{ version: number }>(`INSERT INTO bank_question_version (institution_id,question_id,version,prompt,marks)
      SELECT $1,$2,coalesce(max(version),0)+1,$3,$4 FROM bank_question_version WHERE institution_id=$1 AND question_id=$2 RETURNING version`,
    [scope.institution, id, input.prompt, input.marks]);
    await audit(client, scope, id!, "question.saved", v.version);
    return { question: id!, version: v.version };
  });
}

const composeInput = z.object({ offering: z.uuid(), title: z.string().trim().min(1).max(160), deadline: z.string(), questions: z.array(z.uuid()).min(1).max(50) });
/** FC-008 slice: a draft assignment whose instructions are the selected questions' current versions, with total marks. */
export async function composeAssessment(scope: Scope, raw: unknown) {
  const input = composeInput.parse(raw);
  const visible = new Map((await bankQuestions(scope)).map(q => [q.id, q]));
  const chosen = [...new Set(input.questions)].map(id => visible.get(id));
  if (chosen.some(q => !q)) throw new WorkflowError("Choose questions from your bank or your department’s shared bank.");
  const description = chosen.map((q, n) => `${n + 1}. ${q!.prompt} (${q!.marks} marks · bank: ${q!.topic} v${q!.version})`).join("\n\n");
  return createAssignment(scope, { offering: input.offering, title: input.title, description, deadline: input.deadline,
    marks: chosen.reduce((sum, q) => sum + q!.marks, 0), file: null });
}
