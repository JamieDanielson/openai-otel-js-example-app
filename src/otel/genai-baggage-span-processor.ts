import { propagation } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_GEN_AI_AGENT_NAME, ATTR_GEN_AI_CONVERSATION_ID } from '@opentelemetry/semantic-conventions/incubating';
import { AGENT_NAME_BAGGAGE_KEY, CONVERSATION_ID_BAGGAGE_KEY } from './conversation-context.js';

const BAGGAGE_KEY_TO_ATTRIBUTE = {
  [CONVERSATION_ID_BAGGAGE_KEY]: ATTR_GEN_AI_CONVERSATION_ID,
  [AGENT_NAME_BAGGAGE_KEY]: ATTR_GEN_AI_AGENT_NAME,
} as const;

/**
 * Stamps gen_ai.conversation.id and gen_ai.agent.name onto every span that
 * starts within a context carrying those values in Baggage (see
 * conversation-context.ts) — including spans instrumentation creates itself,
 * which can't be reached by manually calling span.setAttribute() after the
 * fact (the same problem content capture ran into in genai-content.ts). Per
 * semantic-conventions-genai#410, instrumentation should surface a
 * conversation id (or agent name) the app provides via context, never
 * synthesize one itself — this is that context wiring.
 */
export class GenAIBaggageSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const baggage = propagation.getBaggage(parentContext);
    if (!baggage) return;
    for (const [baggageKey, attribute] of Object.entries(BAGGAGE_KEY_TO_ATTRIBUTE)) {
      const value = baggage.getEntry(baggageKey)?.value;
      if (value) {
        span.setAttribute(attribute, value);
      }
    }
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
