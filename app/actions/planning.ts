"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { cancelExam, draftExam, publishExam } from "../../lib/exams";
import { createAction, updateAction } from "../../lib/improvement";
import { decideAllocation, offboard, proposeAllocation } from "../../lib/allocation";
import { decidePolicy, draftPolicy } from "../../lib/policies";
import { addDevelopmentRecord, addResearchMilestone, completeResearchMilestone, decideDevelopmentRecord, decideProject, proposeProject } from "../../lib/faculty-records";
import { renameCatalog } from "../../lib/academics";
import { addCalendarEntry, withdrawCalendarEntry } from "../../lib/calendar";
import { setCatalogVisibility } from "../../lib/catalog";
import { grantDelegation, revokeDelegation } from "../../lib/delegation";
import { draftCertificate, issueCertificate, revokeCertificate } from "../../lib/certificates";
import { createStudyGroup, joinStudyGroup, leaveStudyGroup, saveProfile, setPortfolioItem } from "../../lib/student-life";
import { addMeetingAction, completeMeetingAction, recordMinutes, scheduleMeeting } from "../../lib/meetings";
import { composeAssessment, saveQuestion } from "../../lib/question-bank";
import { addMilestone, createTeam, reviewEvidence, submitEvidence } from "../../lib/teams";
import { savePreferences } from "../../lib/preferences";
import { setDepartmentActive } from "../../lib/active-departments";
import { publishService, withdrawService } from "../../lib/support-services";
import { scope, workspaceQuery } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { "exam-draft": "Sitting drafted.", "exam-publish": "Sitting published.", "exam-cancel": "Sitting cancelled.",
  "action-create": "Action created.", "action-update": "Progress recorded.", "allocation-propose": "Allocation proposed to the office.",
  "allocation-decide": "Decision recorded.", "team-create": "Team formed.", "milestone-add": "Milestone set.", "evidence-submit": "Evidence submitted.",
  "evidence-review": "Review recorded.", "policy-draft": "Draft saved for the principal’s decision.", "policy-decide": "Decision recorded.",
  "question-save": "Question saved as a new version.", "dev-add": "Sent to your department head for verification.", "dev-decide": "Decision recorded.",
  "research-propose": "Proposal sent to your department head.", "research-decide": "Decision recorded.", "research-milestone": "Milestone added.",
  "research-done": "Milestone completed.", "calendar-add": "Date published to everyone's calendar.", "calendar-withdraw": "Date withdrawn.",
  "catalog-show": "Offering shown in the catalog.", "delegation-grant": "Duty delegated until its expiry.", "delegation-revoke": "Delegation revoked.",
  "certificate-draft": "Draft prepared from current records.", "certificate-revoke": "Certificate revoked.", "group-create": "Study group created.",
  "group-join": "You joined the group.", "meeting-schedule": "Meeting scheduled.", "meeting-minutes": "Minutes recorded.",
  "meeting-action": "Action assigned.", "meeting-done": "Action completed.", "portfolio-add": "Added to your portfolio.", "portfolio-remove": "Removed from your portfolio.", "group-leave": "You left the group.", "profile-save": "Profile saved.", "preferences-save": "Preferences saved.", "department-switch": "Department setting saved.", "service-publish": "Service published to the directory.", "service-withdraw": "Service withdrawn.", "catalog-hide": "Offering hidden from the catalog.", rename: "Name corrected; the previous name is kept in the history.", compose: "Draft assignment created from the selected questions." };

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
    else if (operation === "dev-add") await addDevelopmentRecord(current, { department: value("department"), title: value("title"), completed: value("completed"),
      hours: value("hours"), evidence: value("evidence") });
    else if (operation === "dev-decide") await decideDevelopmentRecord(current, { record: value("record"), decision: value("decision"), reason: value("reason") });
    else if (operation === "research-propose") await proposeProject(current, { department: value("department"), title: value("title"), summary: value("summary") });
    else if (operation === "research-decide") await decideProject(current, { project: value("project"), decision: value("decision"), reason: value("reason"), disclosure: value("disclosure") });
    else if (operation === "research-milestone") await addResearchMilestone(current, { project: value("project"), title: value("title"), due: value("due") });
    else if (operation === "research-done") await completeResearchMilestone(current, { milestone: value("milestone"), evidence: value("evidence") });
    else if (operation === "rename") {
      const [entity, id] = String(value("target") ?? "").split("|");
      await renameCatalog(current, { entity: entity as "course" | "section", id, name: String(value("name") ?? ""), reason: String(value("reason") ?? "") });
    }
    else if (operation === "calendar-add") await addCalendarEntry(current, { title: value("title"), kind: value("kind"), from: value("from"), to: value("to") });
    else if (operation === "calendar-withdraw") await withdrawCalendarEntry(current, value("entry"));
    else if (operation === "catalog-show" || operation === "catalog-hide") await setCatalogVisibility(current, String(value("offering") ?? ""), operation === "catalog-show");
    else if (operation === "delegation-grant") await grantDelegation(current, { duty: value("duty"), delegate: value("delegate"), days: value("days"), reason: value("reason") });
    else if (operation === "delegation-revoke") await revokeDelegation(current, value("delegation"));
    else if (operation === "certificate-draft") await draftCertificate(current, { student: value("student"), kind: value("kind") });
    else if (operation === "certificate-issue") {
      const code = await issueCertificate(current, value("certificate"));
      revalidatePath("/", "layout");
      return { message: `Issued. Verification code ${code}.` };
    }
    else if (operation === "certificate-revoke") await revokeCertificate(current, { certificate: value("certificate"), reason: value("reason") });
    else if (operation === "group-create") await createStudyGroup(current, { offering: value("offering"), name: value("name"), capacity: value("capacity") });
    else if (operation === "group-join") await joinStudyGroup(current, value("group"));
    else if (operation === "group-leave") await leaveStudyGroup(current, value("group"));
    else if (operation === "profile-save") await saveProfile(current, { bio: form.get("bio") ?? "", interests: form.get("interests") ?? "", visibility: value("visibility") });
    else if (operation === "meeting-schedule") await scheduleMeeting(current, { title: value("title"), start: value("start"), agenda: value("agenda"),
      participants: form.getAll("participants").map(String) });
    else if (operation === "meeting-minutes") await recordMinutes(current, { meeting: value("meeting"), minutes: value("minutes") });
    else if (operation === "meeting-action") await addMeetingAction(current, { meeting: value("meeting"), owner: value("owner"), title: value("title"), due: value("due") });
    else if (operation === "meeting-done") await completeMeetingAction(current, value("action"));
    else if (operation === "portfolio-add" || operation === "portfolio-remove") await setPortfolioItem(current, { source: value("source"), id: value("id"), include: operation === "portfolio-add" });
    else if (operation === "preferences-save") await savePreferences(current, { large_text: form.get("large_text") === "on", reduced_motion: form.get("reduced_motion") === "on",
      discoverable: form.get("discoverable") === "on", muted_kinds: form.getAll("muted").map(String) });
    else if (operation === "service-publish") await publishService(current, { category: value("category"), name: value("name"), description: value("description"), contact: value("contact"), hours: value("hours") });
    else if (operation === "service-withdraw") await withdrawService(current, value("id"));
    else if (operation === "department-switch") await setDepartmentActive(current, { department: value("department"), active: form.get("active") === "true", reason: value("reason") });
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
