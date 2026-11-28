"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { addHolding, cancelBooking, decideBooking, issueLoan, requestBooking, returnLoan } from "../../lib/operations";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { book: "Booking requested from the office.", decide: "Decision recorded.", cancel: "Booking cancelled.",
  holding: "Added to the library.", issue: "Loan issued.", return: "Return recorded." };

export async function operationsAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) || undefined;
  try {
    if (operation === "book") await requestBooking(current, { room: value("room"), purpose: value("purpose"), supervisor: value("supervisor"), start: value("start"), minutes: value("minutes") });
    else if (operation === "decide") await decideBooking(current, { booking: value("booking"), decision: value("decision"), reason: value("reason") });
    else if (operation === "cancel") await cancelBooking(current, value("booking"));
    else if (operation === "holding") await addHolding(current, { title: value("title"), author: value("author"), copies: value("copies") });
    else if (operation === "issue") await issueLoan(current, { item: value("item")?.toString().split(":")[1], kind: value("item")?.toString().split(":")[0], borrower: value("borrower"), due: value("due") });
    else if (operation === "return") await returnLoan(current, { loan: value("loan"), condition: value("condition") });
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the required fields." };
    console.error("Operations write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  return { message: messages[operation] };
}
