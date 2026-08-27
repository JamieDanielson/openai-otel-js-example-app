import { context, propagation } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';

export const CONVERSATION_ID_BAGGAGE_KEY = 'gen_ai.conversation.id';
export const AGENT_NAME_BAGGAGE_KEY = 'gen_ai.agent.name';

function withBaggageEntry<T>(key: string, value: string, fn: () => T): T {
  const current = propagation.getBaggage(context.active()) ?? propagation.createBaggage();
  return context.with(propagation.setBaggage(context.active(), current.setEntry(key, { value })), fn);
}

/** Runs `fn` inside a context carrying a fresh conversation id in Baggage, so GenAIBaggageSpanProcessor can stamp it onto every span started while `fn` runs — including ones auto-instrumentation creates. */
export function withNewConversation<T>(fn: () => T): T {
  return withBaggageEntry(CONVERSATION_ID_BAGGAGE_KEY, randomUUID(), fn);
}

/** Runs `fn` inside a context carrying `name` as the GenAI agent name in Baggage, stamped onto every span the same way as the conversation id. */
export function withAgentName<T>(name: string, fn: () => T): T {
  return withBaggageEntry(AGENT_NAME_BAGGAGE_KEY, name, fn);
}
