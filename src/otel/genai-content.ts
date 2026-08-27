import { trace } from '@opentelemetry/api';

// TODO(upstream): @opentelemetry/instrumentation-openai captures Chat
// Completions message content as OTel log records (this.logger.emit), not
// span attributes, and doesn't implement the OTEL_SEMCONV_STABILITY_OPT_IN /
// gen_ai_latest_experimental mechanism other instrumentations use for this
// (verified: neither string appears anywhere in its installed source, v0.19.0).
// So there's no supported way to get it to set these attributes itself. Once
// it does — matching its own Responses API code path, which already emits
// gen_ai.input.messages/output.messages as span attributes — this file and
// the manual span.setAttribute() calls in chat.ts/tool-calling.ts that use it
// can be deleted.

/** Span attributes that carry prompt/response content, per the GenAI semantic conventions. Kept as a single source of truth so redaction (content-redacting-span-processor.ts) and manual capture (chat.ts, tool-calling.ts) always agree on the same list. */
export const GENAI_CONTENT_ATTRIBUTES = [
  'gen_ai.system_instructions',
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
] as const;

/** True for a content attribute itself, or a dotted child of one (e.g. `gen_ai.input.messages.0.content`), which some instrumentations use to represent structured content as separate attributes. */
export function isGenAIContentAttribute(key: string): boolean {
  return GENAI_CONTENT_ATTRIBUTES.some((attr) => key === attr || key.startsWith(`${attr}.`));
}

type GenAIContentAttribute = (typeof GENAI_CONTENT_ATTRIBUTES)[number];

/** Sets GenAI content attributes on the currently active span. Content is always set — it's the export path (see content-redacting-span-processor.ts), not the call site, that decides which destinations see it. */
export function setGenAIContent(attrs: Partial<Record<GenAIContentAttribute, unknown>>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    span.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}
