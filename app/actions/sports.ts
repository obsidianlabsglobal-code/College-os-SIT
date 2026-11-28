"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { addTraining, announce, assignCoach, createTeam, createTournament, decideTrial, enterTeam, recordResult, requestTrial, scheduleFixture, setTrials, verifyParticipation } from "../../lib/sports";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { tournament: "Tournament created.", team: "Team created.", coach: "Coach assigned.", trials: "Trials updated.",
  trial: "Trial requested. The coach will decide.", decide: "Decision recorded.", enter: "Team entered.", fixture: "Fixture scheduled.",
  result: "Result recorded.", participation: "Participation verified.", training: "Training published to the team.", announce: "Announcement posted." };

export async function sportsAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) || undefined;
  try {
    if (operation === "tournament") await createTournament(current, { name: value("name"), sport: value("sport"), level: value("level"), starts_on: value("starts_on"), ends_on: value("ends_on") });
    else if (operation === "team") await createTeam(current, { sport: value("sport"), name: value("name"), department: value("department"), external: form.get("external") === "on" });
    else if (operation === "coach") await assignCoach(current, { team: value("team"), coach: value("coach") });
    else if (operation === "trials") await setTrials(current, { team: value("team"), open: form.get("open") === "true" });
    else if (operation === "trial") await requestTrial(current, value("team"));
    else if (operation === "decide") await decideTrial(current, { team: value("team"), student: value("student"), decision: value("decision"), reason: value("reason") });
    else if (operation === "enter") await enterTeam(current, { tournament: value("tournament"), team: value("team") });
    else if (operation === "fixture") await scheduleFixture(current, { tournament: value("tournament"), home: value("home"), away: value("away"), venue: value("venue"),
      official: value("official"), start: value("start"), minutes: value("minutes") });
    else if (operation === "result") await recordResult(current, { fixture: value("fixture"), home: value("home"), away: value("away"), reason: value("reason") });
    else if (operation === "participation") await verifyParticipation(current, { fixture: value("fixture"), students: form.getAll("students").map(String) });
    else if (operation === "training") await addTraining(current, { team: value("team"), venue: value("venue"), start: value("start"), minutes: value("minutes") });
    else if (operation === "announce") await announce(current, { team: value("team"), body: value("body") });
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues.find(i => i.code === "custom")?.message ?? "Check the required fields." };
    console.error("Sports write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  return { message: messages[operation] };
}
