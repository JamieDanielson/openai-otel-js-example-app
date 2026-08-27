import type { Attributes, Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { isGenAIContentAttribute } from './genai-content.js';

/**
 * Wraps a SpanProcessor and strips GenAI content attributes before forwarding
 * a span to it. Never mutates the original span: MultiSpanProcessor invokes
 * every registered processor's onEnd() with the *same* span object, so
 * deleting attributes in place would also erase them for a sibling processor
 * (e.g. one exporting full content to an eval platform) reading that same
 * object later on its own schedule. Building a separate filtered copy keeps
 * this processor's redaction from affecting what any other processor sees.
 */
export class ContentRedactingSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const hasContent = Object.keys(span.attributes).some(isGenAIContentAttribute);
    if (!hasContent) {
      this.inner.onEnd(span);
      return;
    }

    const attributes: Attributes = {};
    for (const [key, value] of Object.entries(span.attributes)) {
      if (!isGenAIContentAttribute(key)) {
        attributes[key] = value;
      }
    }

    this.inner.onEnd({
      name: span.name,
      kind: span.kind,
      spanContext: () => span.spanContext(),
      parentSpanContext: span.parentSpanContext,
      startTime: span.startTime,
      endTime: span.endTime,
      status: span.status,
      attributes,
      links: span.links,
      events: span.events,
      duration: span.duration,
      ended: span.ended,
      resource: span.resource,
      instrumentationScope: span.instrumentationScope,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    });
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
