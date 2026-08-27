import { describe, it, expect, vi } from 'vitest';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ContentRedactingSpanProcessor } from '../../src/otel/content-redacting-span-processor.js';

function fakeSpan(attributes: Record<string, unknown>): ReadableSpan {
  return {
    name: 'chat gpt-4o-mini',
    attributes,
  } as unknown as ReadableSpan;
}

describe('ContentRedactingSpanProcessor', () => {
  it('strips GenAI content attributes and their dotted children before forwarding to the inner processor', () => {
    const inner: SpanProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn(),
      shutdown: vi.fn(),
    };
    const processor = new ContentRedactingSpanProcessor(inner);

    const span = fakeSpan({
      'gen_ai.request.model': 'gpt-4o-mini',
      'gen_ai.input.messages': '[{"role":"user","content":"hi"}]',
      'gen_ai.input.messages.truncated': true,
      'gen_ai.tool.call.arguments': '{"location":"Boston"}',
    });

    processor.onEnd(span);

    expect(inner.onEnd).toHaveBeenCalledTimes(1);
    const forwarded = (inner.onEnd as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReadableSpan;
    expect(forwarded.attributes).toEqual({ 'gen_ai.request.model': 'gpt-4o-mini' });
  });

  it('does not mutate the original span object, so a sibling processor still sees full content', () => {
    const inner: SpanProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn(),
      shutdown: vi.fn(),
    };
    const processor = new ContentRedactingSpanProcessor(inner);

    const originalAttributes = {
      'gen_ai.request.model': 'gpt-4o-mini',
      'gen_ai.input.messages': '[{"role":"user","content":"hi"}]',
    };
    const span = fakeSpan(originalAttributes);

    processor.onEnd(span);

    // The whole point: a sibling SpanProcessor in the same spanProcessors
    // array (e.g. one sending full content elsewhere) receives the same
    // span object reference. If this processor deleted keys in place, that
    // sibling would see the redacted version too — regardless of processor
    // order, since MultiSpanProcessor calls onEnd() on each synchronously
    // with the same reference.
    expect(span.attributes).toBe(originalAttributes);
    expect(span.attributes).toEqual({
      'gen_ai.request.model': 'gpt-4o-mini',
      'gen_ai.input.messages': '[{"role":"user","content":"hi"}]',
    });
  });

  it('forwards spans with no content attributes unchanged', () => {
    const inner: SpanProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn(),
      shutdown: vi.fn(),
    };
    const processor = new ContentRedactingSpanProcessor(inner);

    const span = fakeSpan({ 'gen_ai.request.model': 'gpt-4o-mini' });
    processor.onEnd(span);

    expect(inner.onEnd).toHaveBeenCalledWith(span);
  });
});
