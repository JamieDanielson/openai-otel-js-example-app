import { describe, it, expect, vi } from 'vitest';
import { context, propagation } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';
import { GenAIBaggageSpanProcessor } from '../../src/otel/genai-baggage-span-processor.js';
import { AGENT_NAME_BAGGAGE_KEY, CONVERSATION_ID_BAGGAGE_KEY } from '../../src/otel/conversation-context.js';

function fakeSpan(): Span {
  return { setAttribute: vi.fn() } as unknown as Span;
}

describe('GenAIBaggageSpanProcessor', () => {
  it('stamps gen_ai.conversation.id from Baggage onto the starting span', () => {
    const processor = new GenAIBaggageSpanProcessor();
    const span = fakeSpan();
    const baggage = propagation.createBaggage({ [CONVERSATION_ID_BAGGAGE_KEY]: { value: 'conv-123' } });
    const ctx = propagation.setBaggage(context.active(), baggage);

    processor.onStart(span, ctx);

    expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.conversation.id', 'conv-123');
  });

  it('stamps gen_ai.agent.name from Baggage onto the starting span', () => {
    const processor = new GenAIBaggageSpanProcessor();
    const span = fakeSpan();
    const baggage = propagation.createBaggage({ [AGENT_NAME_BAGGAGE_KEY]: { value: 'chat-agent' } });
    const ctx = propagation.setBaggage(context.active(), baggage);

    processor.onStart(span, ctx);

    expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.agent.name', 'chat-agent');
  });

  it('stamps both when both are present in Baggage', () => {
    const processor = new GenAIBaggageSpanProcessor();
    const span = fakeSpan();
    const baggage = propagation.createBaggage({
      [CONVERSATION_ID_BAGGAGE_KEY]: { value: 'conv-123' },
      [AGENT_NAME_BAGGAGE_KEY]: { value: 'chat-agent' },
    });
    const ctx = propagation.setBaggage(context.active(), baggage);

    processor.onStart(span, ctx);

    expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.conversation.id', 'conv-123');
    expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.agent.name', 'chat-agent');
  });

  it('does nothing when the context carries neither value', () => {
    const processor = new GenAIBaggageSpanProcessor();
    const span = fakeSpan();

    processor.onStart(span, context.active());

    expect(span.setAttribute).not.toHaveBeenCalled();
  });
});
