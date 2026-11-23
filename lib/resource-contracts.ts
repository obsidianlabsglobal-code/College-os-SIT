import { z } from "zod";

const id = z.uuid();
const reason = z.string().trim().min(1).max(400);
export const resourceInput = z.discriminatedUnion("operation",[
  z.object({operation:z.literal("create"),name:z.string().trim().min(1).max(100),kind:z.enum(["room","equipment"]),
    location:z.string().trim().min(1).max(180),
    capacity:z.preprocess(value=>value === "" || value === undefined ? undefined : value,z.coerce.number().int().min(1).max(100000).optional())}),
  z.object({operation:z.literal("grant"),resource:id,account:z.string().min(1).max(100),days:z.coerce.number().int().min(1).max(365)}),
  z.object({operation:z.literal("revoke"),grant:id}),
  z.object({operation:z.literal("request"),event:id,resource:id}),
  z.object({operation:z.literal("confirm"),booking:id,revision:z.coerce.number().int().min(0)}),
  z.object({operation:z.enum(["decline","cancel"]),booking:id,revision:z.coerce.number().int().min(0),reason}),
]);
