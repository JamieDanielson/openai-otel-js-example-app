import { SpanStatusCode, trace } from '@opentelemetry/api';
import { ATTR_GEN_AI_OPERATION_NAME, GEN_AI_OPERATION_NAME_VALUE_INVOKE_WORKFLOW } from '@opentelemetry/semantic-conventions/incubating';
import { run as chat } from './chat.js';
import { run as streaming } from './streaming.js';
import { run as embeddings } from './embeddings.js';
import { run as toolCalling } from './tool-calling.js';
import { run as errorCase } from './error-case.js';

const tracer = trace.getTracer('openai-otel-js-example-app');

export async function run(): Promise<void> {
  // Wrapping every scenario in one active span makes them all children of
  // the same root, so they land in Honeycomb as a single trace instead of
  // five unrelated ones. Named and attributed as an invoke_workflow span
  // (semantic-conventions-genai#410) since it's a workflow boundary
  // coordinating five separately-named agent invocations, each of which
  // sets its own gen_ai.agent.name — this is what makes the Honeycomb Agent
  // Timeline's multi-agent swim lanes show up within one conversation.
  return tracer.startActiveSpan('invoke_workflow all scenarios', async (span) => {
    span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, GEN_AI_OPERATION_NAME_VALUE_INVOKE_WORKFLOW);
    try {
      await chat();
      await streaming();
      await embeddings();
      await toolCalling();
      await errorCase();
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
