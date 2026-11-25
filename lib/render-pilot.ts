import { databaseConnection } from "./database-target";
import { isReleaseRevision } from "./release-revision";

export function renderPilotConfig(env: Readonly<Record<string, string | undefined>>) {
  const origin = env.RENDER_EXTERNAL_URL;
  const revision = env.RENDER_GIT_COMMIT;
  const port = Number(env.PORT ?? 10000);
  if (env.RENDER !== "true" || env.NEXUS_FICTIONAL_PILOT !== "true" ||
      !origin || !/^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/.test(origin) ||
      !isReleaseRevision(revision) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Use a dedicated Render service configured for the fictional NEXUS pilot.");
  }
  if (env.BETTER_AUTH_URL !== origin || (env.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    throw new Error("Set the exact Render origin and a generated Better Auth secret.");
  }
  if (env.NEXUS_DEMO_SEED || env.NEXUS_DEMO_PASSWORD || env.MIGRATION_DATABASE_URL ||
      env.ANTHROPIC_API_KEY || env.AURA_MODEL_ENABLED !== "false") {
    throw new Error("Keep migration, seed and AI provider credentials outside the pilot web service.");
  }
  const connection = databaseConnection("runtime", env);
  const host = new URL(connection).hostname;
  if (!host.endsWith(".neon.tech") || !env.NEXUS_RUNTIME_TARGET) {
    throw new Error("Use the dedicated, allowlisted Neon runtime database for this pilot.");
  }
  return { revision, port };
}
