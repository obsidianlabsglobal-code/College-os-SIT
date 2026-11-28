"use server";

import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { removePushSubscriptions, savePushSubscription } from "../../lib/push";
import { scope } from "../../lib/scope";

export async function subscribePush(context: { institution: string; role: string }, endpoint: string) {
  const current = await scope(context.institution, context.role);
  try {
    await savePushSubscription(current, { endpoint });
    return { ok: true as const };
  } catch (error) {
    if (error instanceof WorkflowError || error instanceof z.ZodError) return { ok: false as const, error: "Notifications could not be turned on here." };
    throw error;
  }
}

export async function unsubscribePush(context: { institution: string; role: string }) {
  await removePushSubscriptions(await scope(context.institution, context.role));
  return { ok: true as const };
}
