import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export type ModelUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelResult<T> =
  | { ok: true; parsed: T; usage: ModelUsage; requestId: string | null; model: string; stopReason: string | null; latencyMs: number }
  | { ok: false; failure: string; indeterminate: boolean; usage: ModelUsage | null; requestId: string | null; latencyMs: number };

export interface ModelProvider {
  id: string;
  // Confirms the configured model id exists for this credential. Never spends tokens.
  available(model: string): Promise<boolean>;
  structured<T extends z.ZodType>(request: {
    model: string; system: string; message: string; schema: T; maxTokens: number; timeoutMs: number;
  }): Promise<ModelResult<z.infer<T>>>;
}

const noUsage = null;

function usageOf(usage: Anthropic.Usage): ModelUsage {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

const verified = new Map<string, { ok: boolean; at: number }>();

// The only code path that talks to Anthropic. It receives text and a schema; it never receives database handles,
// credentials, tool executors or records. Retries are disabled so an uncertain paid call is never repeated blindly.
export function anthropicProvider(): ModelProvider {
  const client = new Anthropic({ maxRetries: 0 });
  return {
    id: "anthropic",
    async available(model) {
      const cached = verified.get(model);
      if (cached && Date.now() - cached.at < 10 * 60_000) return cached.ok;
      try {
        const found = await client.models.retrieve(model, null, { timeout: 5000 });
        verified.set(model, { ok: found.id === model, at: Date.now() });
      } catch (error) {
        if (error instanceof Anthropic.NotFoundError) verified.set(model, { ok: false, at: Date.now() });
        else return false;
      }
      return verified.get(model)!.ok;
    },
    async structured({ model, system, message, schema, maxTokens, timeoutMs }) {
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: message }],
          output_config: { effort: "low", format: zodOutputFormat(schema) },
        }, { timeout: timeoutMs });
        const usage = usageOf(response.usage);
        const requestId = response._request_id ?? null;
        if (response.stop_reason === "refusal") {
          return { ok: false, failure: "The model declined this request.", indeterminate: false, usage, requestId, latencyMs: elapsed() };
        }
        if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
          return { ok: false, failure: "The model response was incomplete.", indeterminate: false, usage, requestId, latencyMs: elapsed() };
        }
        return { ok: true, parsed: response.parsed_output, usage, requestId, model: response.model, stopReason: response.stop_reason, latencyMs: elapsed() };
      } catch (error) {
        // A timeout or dropped connection may still have been billed; the caller keeps the reservation as spent.
        if (error instanceof Anthropic.APIConnectionError) {
          return { ok: false, failure: "The model provider did not respond in time.", indeterminate: true, usage: noUsage, requestId: null, latencyMs: elapsed() };
        }
        if (error instanceof Anthropic.RateLimitError) {
          return { ok: false, failure: "The model provider is rate limiting requests.", indeterminate: false, usage: noUsage, requestId: error.requestID ?? null, latencyMs: elapsed() };
        }
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
          return { ok: false, failure: "The model provider credential was rejected.", indeterminate: false, usage: noUsage, requestId: error.requestID ?? null, latencyMs: elapsed() };
        }
        if (error instanceof Anthropic.APIError) {
          return { ok: false, failure: `The model provider returned an error (${error.status ?? "unknown"}).`, indeterminate: (error.status ?? 500) >= 500, usage: noUsage, requestId: error.requestID ?? null, latencyMs: elapsed() };
        }
        return { ok: false, failure: "The model response could not be validated.", indeterminate: false, usage: noUsage, requestId: null, latencyMs: elapsed() };
      }
    },
  };
}
