import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { ATTR_GEN_AI_OPERATION_NAME, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT } from '@opentelemetry/semantic-conventions/incubating';
import { withAgentName } from './conversation-context.js';

const tracer = trace.getTracer('openai-otel-js-example-app');

/**
 * Runs `fn` inside an `invoke_agent {agentName}` span carrying
 * `gen_ai.operation.name` and `gen_ai.agent.name` — the span shape Honeycomb's
 * Agent Timeline groups a conversation's spans under (see the "What's
 * automatic vs. what we added" section in README.md). Also puts `agentName`
 * in Baggage so GenAIBaggageSpanProcessor stamps it onto every span `fn`
 * creates, including auto-instrumented ones nested inside it.
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
