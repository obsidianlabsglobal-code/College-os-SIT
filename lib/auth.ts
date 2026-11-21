import { betterAuth } from "better-auth";
import { db } from "./db";

export const auth = betterAuth({
  database: db,
  emailAndPassword: { enabled: true, disableSignUp: true },
  advanced: {
    ipAddress: {
      ipAddressHeaders: process.env.VERCEL ? ["x-vercel-forwarded-for"] : ["x-forwarded-for"],
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: { "/sign-in/email": { window: 60, max: 20 } },
  },
});
