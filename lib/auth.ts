import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { db } from "./db";
import { sendMail } from "./email";

const CODES_PER_EMAIL_PER_HOUR = 5;

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
    customRules: { "/sign-in/email": { window: 60, max: 20 }, "/email-otp/send-verification-otp": { window: 600, max: 10 }, "/sign-in/email-otp": { window: 60, max: 10 } },
  },
  plugins: [emailOTP({
    // AD-002: a 6-digit code that works once, expires in 10 minutes and allows three attempts; stored hashed.
    otpLength: 6, expiresIn: 600, allowedAttempts: 3, storeOTP: "hashed",
    async sendVerificationOTP({ email, otp, type }) {
      if (type !== "sign-in") return;
      const address = email.trim().toLowerCase();
      const { rows: [{ count }] } = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM sign_in_code_request WHERE email=$1 AND requested_at > clock_timestamp()-interval '1 hour'", [address]);
      if (count >= CODES_PER_EMAIL_PER_HOUR) throw new APIError("TOO_MANY_REQUESTS", { message: "Too many codes for this email. Try again later." });
      await db.query("INSERT INTO sign_in_code_request (email) VALUES ($1)", [address]);
      await sendMail({ to: address, subject: `${otp} is your NEXUS sign-in code`,
        text: `Your NEXUS sign-in code is ${otp}. It works once and expires in 10 minutes.\n\nIf you did not ask for it, ignore this email.` });
    },
  })],
});
