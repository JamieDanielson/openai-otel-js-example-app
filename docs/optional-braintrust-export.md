# Optional: split-export full content to Braintrust

Not part of this app by default — this repo intentionally stays a basic,
dependency-light example. This is a documented pattern, not code that runs
here, for anyone who wants full-content GenAI spans to also reach an eval
platform.

## Why you'd want this

`src/otel/content-redacting-span-processor.ts` strips prompt/response
content (`gen_ai.input.messages`, `gen_ai.output.messages`, etc. — see
`src/otel/genai-content.ts`) before the Honeycomb export, since Honeycomb is
typically read broadly across a team. An eval/judge platform is a narrower,
different audience that often needs the full content to score responses.
[Braintrust](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)
publishes an OTel `SpanProcessor` for exactly this: add it as a second,
unredacted destination alongside the redacted Honeycomb one.

## How to add it

1. Install the package (not a dependency of this repo):

   ```bash
   npm install @braintrust/otel
   ```

2. In `src/telemetry.ts`, import it and push it onto `spanProcessors`
   alongside the existing Honeycomb-bound one, guarded by an env var so it's
   opt-in:

   ```ts
   import { BraintrustSpanProcessor } from '@braintrust/otel';

   // ...after building `spanProcessors`:
   if (process.env.BRAINTRUST_API_KEY) {
     spanProcessors.push(
       new BraintrustSpanProcessor({
         apiKey: process.env.BRAINTRUST_API_KEY,
         parent: process.env.BRAINTRUST_PARENT,
         filterAISpans: true,
       }),
     );
   }
   ```

3. Add `BRAINTRUST_API_KEY` (and optionally `BRAINTRUST_PARENT`, e.g.
   `project_name:my-project`) to `.env`.

Because `ContentRedactingSpanProcessor` builds a filtered *copy* of each
span's attributes rather than mutating the original (see its tests in
`test/otel/content-redacting-span-processor.test.ts`), the Braintrust
processor — added after it — still sees the full, unredacted span. Processor
order in the array doesn't matter for this; what matters is that the
redactor never mutates the shared span object.
