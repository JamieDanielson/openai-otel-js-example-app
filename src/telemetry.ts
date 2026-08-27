import 'dotenv/config';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { ContentRedactingSpanProcessor } from './otel/content-redacting-span-processor.js';
import { GenAIBaggageSpanProcessor } from './otel/genai-baggage-span-processor.js';

// Must run before any module in this process imports 'openai', so the
// import-in-the-middle-based patch below has a load event to intercept.
register('@opentelemetry/instrumentation/hook.mjs', pathToFileURL('./'));

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'https://api.honeycomb.io';
const apiKey = process.env.HONEYCOMB_API_KEY;

if (!apiKey) {
  throw new Error('HONEYCOMB_API_KEY is not set. Add it to .env before running a scenario.');
}

// Content is always set on spans (see src/otel/genai-content.ts) — it's this
// export wiring, not the call sites, that decides whether it leaves the
// process. By default the Honeycomb-bound processor is wrapped to strip
// GenAI content attributes before export, since Honeycomb is read broadly
// across a team; set OTEL_GENAI_CAPTURE_CONTENT=true to disable that (e.g.
// local dev with no real user data) and let full content reach Honeycomb too.
// See docs/optional-braintrust-export.md for sending full content to a
// second, narrowly-read destination instead.
let honeycombSpanProcessor: SpanProcessor = new BatchSpanProcessor(
  new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers: { 'x-honeycomb-team': apiKey },
  }),
);
if (process.env.OTEL_GENAI_CAPTURE_CONTENT !== 'true') {
  honeycombSpanProcessor = new ContentRedactingSpanProcessor(honeycombSpanProcessor);
}

const spanProcessors: SpanProcessor[] = [
  // Stamps gen_ai.conversation.id and gen_ai.agent.name (from Baggage — see
  // run-scenario.ts and each scenario's use of withAgentName()) onto every
  // span as it starts, including ones instrumentation creates itself. Listed
  // first, but order doesn't matter here: onStart sets attributes directly
  // on the live Span, before any destination-specific processor (below)
  // reads it on export.
  new GenAIBaggageSpanProcessor(),
  // Console output is for immediate local demo feedback, not production
  // telemetry (and never leaves this machine), so it's left unredacted.
  new SimpleSpanProcessor(new ConsoleSpanExporter()),
  honeycombSpanProcessor,
];

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'openai-otel-js-example-app',
  }),
  spanProcessors,
  instrumentations: [new OpenAIInstrumentation(), new HttpInstrumentation(), new ExpressInstrumentation()],
});

sdk.start();

process.once('beforeExit', async () => {
  // SimpleSpanProcessor#shutdown() does not wait for exports already in
  // flight (only forceFlush() does), so a scenario that ends several spans
  // in quick succession can have its last export cut off by process exit
  // unless every processor is flushed explicitly before shutdown.
  await Promise.all(spanProcessors.map((processor) => processor.forceFlush()));
  await sdk.shutdown();
});
