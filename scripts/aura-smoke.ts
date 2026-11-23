import "./environment";
import { z } from "zod";
import { auraModelConfig, costMicros } from "../lib/aura/config";
import { anthropicProvider } from "../lib/aura/provider";

// One real, paid inference with fictional input. It refuses to run unless the operator has set a credential in
// local secret storage, configured a price for the model, and approved a spending cap for this script.
// It prints evidence (model, request id, tokens, latency, computed cost) and never prints the credential.

async function main() {
  const approved = Number(process.env.AURA_SMOKE_APPROVED_USD);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Blocked: no ANTHROPIC_API_KEY in local secret storage.");
  if (!(approved > 0 && approved <= 1)) throw new Error("Blocked: set AURA_SMOKE_APPROVED_USD to the approved cap (0 < cap <= 1).");
  const config = auraModelConfig();
  if ("error" in config) throw new Error(config.error);
  const model = config.routineModel;
  const rate = config.prices[model];
  if (!rate) throw new Error(`Blocked: no verified price configured for ${model} in AURA_MODEL_PRICES.`);
  const maxTokens = 600;
  const worst = (2000 * rate.input + maxTokens * rate.output) / 1_000_000;
  if (worst > approved) throw new Error(`Blocked: worst case $${worst.toFixed(4)} exceeds the approved $${approved}.`);

  const provider = anthropicProvider();
  if (!(await provider.available(model))) throw new Error(`Blocked: ${model} is not available to this credential.`);
  const result = await provider.structured({
    model, maxTokens, timeoutMs: 30000,
    system: "Classify the request for a fictional college app. Return the capability that answers it, or unsupported.",
    message: "Fictional test student: which of my assignments are still open this week?",
    schema: z.object({ capability: z.enum(["list_my_assignments", "list_notices", "unsupported"]), reason: z.string() }).strict(),
  });
  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, failure: result.failure, requestId: result.requestId, indeterminate: result.indeterminate }, null, 2));
    process.exitCode = 1;
    return;
  }
  const cost = costMicros(config, model, { input: result.usage.input + result.usage.cacheWrite * 1.25 + result.usage.cacheRead * 0.1, output: result.usage.output });
  console.log(JSON.stringify({
    ok: true, provider: provider.id, model: result.model, requestId: result.requestId, stopReason: result.stopReason,
    usage: result.usage, latencyMs: result.latencyMs, computedCostUsd: cost === null ? null : cost / 1_000_000, output: result.parsed,
  }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Smoke test failed."); process.exitCode = 1; });
