import { betterAuth } from "better-auth";
import { db } from "./db";

export const auth = betterAuth({
  database: db,
  emailAndPassword: { enabled: true, disableSignUp: true },
  rateLimit: { enabled: true },
});
