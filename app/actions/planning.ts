"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { cancelExam, draftExam, publishExam } from "../../lib/exams";
import { createAction, updateAction } from "../../lib/improvement";
import { decideAllocation, offboard, proposeAllocation } from "../../lib/allocation";
import { decidePolicy, draftPolicy } from "../../lib/policies";
import { composeAssessment, saveQuestion } from "../../lib/question-bank";
import { addMilestone, createTeam, reviewEvidence, submitEvidence } from "../../lib/teams";
import { scope, workspaceQuery } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { "exam-draft": "Sitting drafted.", "exam-publish": "Sitting published.", "exam-cancel": "Sitting cancelled.",
  "action-create": "Action created.", "action-update": "Progress recorded.", "allocation-propose": "Allocation proposed to the office.",
  "allocation-decide": "Decision recorded.", "team-create": "Team formed.", "milestone-add": "Milestone set.", "evidence-submit": "Evidence submitted.",
  "evidence-review": "Review recorded.", "policy-draft": "Draft saved for the principal’s decision.", "policy-decide": "Decision recorded.",
  "question-save": "Question saved as a new version.", compose: "Draft assignment created from the selected questions." };

export async function planningAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) || undefined;
  let destination: string | undefined;
  try {
    if (operation === "exam-draft") await draftExam(current, { offering: value("offering"), kind: value("kind"), title: value("title"), start: value("start"),
      end: value("end"), room: value("room"), invigilator: value("invigilator"), source: value("source") });
    else if (operation === "exam-publish") await publishExam(current, { exam: value("exam"), revision: Number(value("revision")) });
    else if (operation === "exam-cancel") await cancelExam(current, { exam: value("exam"), reason: value("reason") });
    else if (operation === "action-create") {
      const [owner, department] = String(value("owner") ?? "").split("|");
      await createAction(current, { title: value("title"), measure: value("measure"), owner, department: department || undefined, due: value("due") });
    } else if (operation === "action-update") await updateAction(current, { action: value("action"), progress: value("progress"), note: value("note"), close: value("close") });
    else if (operation === "allocation-propose") await proposeAllocation(current, { offering: value("offering"), faculty: value("faculty"), reason: value("reason") });
    else if (operation === "allocation-decide") await decideAllocation(current, { proposal: value("proposal"), decision: value("decision"), reason: value("reason") });
    else if (operation === "offboard") {
      const e = await offboard(current, value("account"));
      revalidatePath("/", "layout");
      return { message: `Access ended: ${e.memberships} posts, ${e.rosters} course rosters, ${e.mentoring} mentoring pairings. Needs a new owner: ${e.open_cases} cases, ${e.open_requests} requests.` };
    }
    else if (operation === "team-create") await createTeam(current, { offering: value("offering"), name: value("name"), students: form.getAll("students").map(String) });
    else if (operation === "milestone-add") await addMilestone(current, { offering: value("offering"), title: value("title"), due: value("due") });
    else if (operation === "evidence-submit") await submitEvidence(current, { milestone: value("milestone"), body: value("body") });
    else if (operation === "evidence-review") await reviewEvidence(current, { evidence: value("evidence"), decision: value("decision"), note: value("note") });
    else if (operation === "policy-draft") await draftPolicy(current, { policy: value("policy"), kind: value("kind"), title: value("title"),
      audience: value("audience"), body: value("body"), threshold: value("threshold") });
    else if (operation === "policy-decide") await decidePolicy(current, { policy: value("policy"), version: value("version"), decision: value("decision"), reason: value("reason") });
    else if (operation === "question-save") await saveQuestion(current, { question: value("question"), department: value("department"), topic: value("topic"),
      visibility: value("visibility"), prompt: value("prompt"), marks: value("marks") });
    else if (operation === "compose") destination = `/assignments/${await composeAssessment(current, { offering: value("offering"), title: value("title"),
      deadline: value("deadline"), questions: form.getAll("questions").map(String) })}?${workspaceQuery(current)}`;
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues.find(i => !i.message.startsWith("Invalid") && !i.message.startsWith("Too"))?.message ?? "Check the required fields." };
    console.error("Planning write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  if (destination) redirect(destination);
  return { message: messages[operation] };
}
