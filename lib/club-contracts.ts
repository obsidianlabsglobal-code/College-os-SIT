import { z } from "zod";

const text = (limit: number) => z.string().trim().min(1).max(limit);
const uuid = z.uuid();
const revision = z.coerce.number().int().min(0).max(2147483646);
const date = z.iso.datetime({ local: true, precision: -1 }).refine(value => !value.endsWith("Z"));

export const eventInput = z.object({
  club: uuid, title: text(140), location: text(180), requirements: text(4000),
  audience: z.enum(["club", "eligible"]), starts: date, ends: date,
  capacity: z.coerce.number().int().min(1).max(10000),
});
export type EventInput = z.infer<typeof eventInput>;

const proposal = {
  name: text(120), purpose: text(4000), rules: text(4000), category: text(40),
  template: z.string().max(40).optional(),
  joining: z.enum(["open", "approval", "invitation"]),
  audience: z.enum(["students", "faculty", "campus"]),
};
const target = { club: uuid, person: text(128) };
export const clubInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("draft"), ...proposal }),
  z.object({ operation: z.literal("revise"), id: uuid, revision, ...proposal }),
  z.object({ operation: z.literal("proposal"), id: uuid, revision,
    next: z.enum(["submitted", "under_review", "changes_requested", "approved", "rejected"]), note: z.string().trim().max(2000).optional() }),
  z.object({ operation: z.literal("join"), club: uuid }),
  z.object({ operation: z.literal("membership"), ...target, next: z.enum(["active", "declined", "ended", "invited"]) }),
  z.object({ operation: z.literal("grant"), ...target, kind: z.enum(["officer", "advisor"]) }),
  z.object({ operation: z.literal("revoke"), club: uuid, grant: uuid }),
  z.object({ operation: z.literal("club-state"), club: uuid, next: z.enum(["active", "suspended", "archived"]) }),
  z.object({ operation: z.literal("handover"), ...target, note: text(4000) }),
  z.object({ operation: z.literal("approve-handover"), club: uuid, id: uuid }),
  z.object({ operation: z.literal("cancel-handover"), club: uuid, id: uuid }),
  z.object({ operation: z.literal("event-draft"), ...eventInput.shape }),
  z.object({ operation: z.literal("event-state"), club: uuid, id: uuid, revision,
    next: z.enum(["pending_approval", "approved", "published", "registration_open", "registration_closed", "in_progress", "completed", "cancelled"]) }),
  z.object({ operation: z.literal("register"), club: uuid, id: uuid }),
  z.object({ operation: z.literal("verify"), club: uuid, id: uuid, person: text(128), note: text(2000) }),
]);
export type ClubInput = z.infer<typeof clubInput>;
