import { betterAuth } from "better-auth";
import { db } from "./db";

export const auth = betterAuth({
  database: db,
  emailAndPassword: { enabled: true, disableSignUp: true },
  advanced: {
    ipAddress: {
      // The small fictional pilot uses Better Auth's database-backed shared
      // path bucket rather than interpreting externally supplied proxy headers.
      // Do not set disableIpTracking: Better Auth would skip rate limiting.
      ipAddressHeaders: process.env.NEXUS_FICTIONAL_PILOT === "true"
        ? [] : process.env.VERCEL ? ["x-vercel-forwarded-for"] : ["x-forwarded-for"],
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: { "/sign-in/email": { window: 60, max: 20 } },
  },
});
