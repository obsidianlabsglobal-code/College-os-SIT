import { z } from "zod";

// Every value here is server-only configuration. Nothing in this file is sent to the browser or to the model.
// Prices are operator-supplied (USD per million tokens) and must be checked against the provider's pricing page:
// the code never assumes a price it was not given, and a model without a configured price cannot be called.

const price = z.object({ input: z.number().positive(), output: z.number().positive() }).strict();
const dollars = z.coerce.number().positive().max(1000);

const schema = z.object({
  enabled: z.enum(["true","false"]).default("false").transform(value => value === "true"),
  apiKeyPresent: z.boolean(),
  routineModel: z.string().regex(/^[a-z0-9.-]{3,80}$/).default("claude-haiku-5-5"),
  complexModel: z.string().regex(/^[a-z0-9.-]{3,80}$/).default("claude-opus-5-5"),
  prices: z.record(z.string(), price).default({}),
  institutions: z.array(z.uuid()).default([]),
  totalCapUsd: dollars.default(10),
  dailyInstitutionCapUsd: dollars.default(2),
  perCallCapUsd: dollars.default(0.1),
  maxOutputTokens: z.coerce.number().int().min(256).max(8000).default(1500),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).default(20000),
});

export type AuraModelConfig = z.infer<typeof schema>;

function parsePrices(raw: string | undefined) {
  if (!raw) return {};
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

export function auraModelConfig(env: NodeJS.ProcessEnv = process.env): AuraModelConfig | { error: string } {
  const result = schema.safeParse({
    enabled: env.AURA_MODEL_ENABLED || undefined,
    apiKeyPresent: Boolean(env.ANTHROPIC_API_KEY),
    routineModel: env.AURA_MODEL_ROUTINE || undefined,
    complexModel: env.AURA_MODEL_COMPLEX || undefined,
    prices: parsePrices(env.AURA_MODEL_PRICES),
    institutions: env.AURA_MODEL_INSTITUTIONS ? env.AURA_MODEL_INSTITUTIONS.split(",").map(value => value.trim()).filter(Boolean) : undefined,
    totalCapUsd: env.AURA_TOTAL_CAP_USD || undefined,
    dailyInstitutionCapUsd: env.AURA_DAILY_INSTITUTION_CAP_USD || undefined,
    perCallCapUsd: env.AURA_PER_CALL_CAP_USD || undefined,
    maxOutputTokens: env.AURA_MAX_OUTPUT_TOKENS || undefined,
    timeoutMs: env.AURA_TIMEOUT_MS || undefined,
  });
  return result.success ? result.data : { error: "AURA model configuration is invalid." };
}

export const micros = (usd: number) => Math.ceil(usd * 1_000_000);

// Why the model path is closed for this request, or null when it may be attempted.
export function modelGate(config: ReturnType<typeof auraModelConfig>, institution: string) {
  if ("error" in config) return config.error;
  if (!config.enabled) return "Model assistance is turned off for this deployment.";
  if (!config.apiKeyPresent) return "No model provider credential is configured.";
  if (!config.institutions.includes(institution)) return "Model assistance is not approved for this institution's data.";
  return null;
}

export function costMicros(config: AuraModelConfig, model: string, usage: { input: number; output: number }) {
  const rate = config.prices[model];
  if (!rate) return null;
  return micros((usage.input * rate.input + usage.output * rate.output) / 1_000_000);
}
