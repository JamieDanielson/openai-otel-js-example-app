import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { ATTR_GEN_AI_OPERATION_NAME, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating';
import { withAgentName } from './conversation-context.js';

const tracer = trace.getTracer('openai-otel-js-example-app');

/**
 * Optional: runs `fn` inside an `invoke_agent {agentName}` span carrying
 * `gen_ai.operation.name` and `gen_ai.agent.name` — the span shape Honeycomb's
 * Agent Timeline groups a conversation's spans under (see "Making the
 * Honeycomb Agent Timeline work" in README.md). Also puts `agentName` in
 * Baggage so GenAIBaggageSpanProcessor stamps it onto every span `fn`
 * creates, including auto-instrumented ones nested inside it.
 *
 * Not required to keep `fn`'s spans in one trace with the rest of the app —
 * `run-scenario.ts` already runs everything inside `all.ts`'s own active
 * span, so that happens regardless. This exists solely to give `fn` its own
 * named agent identity and swim lane in the Agent Timeline; omit it and
 * `fn`'s spans still land in the same trace, just without one.
 */
export function invokeAgent<T>(agentName: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return withAgentName(agentName, () =>
    tracer.startActiveSpan(`invoke_agent ${agentName}`, async (span) => {
      span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT);
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err instanceof Error ? err : String(err));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    }),
  );
}
