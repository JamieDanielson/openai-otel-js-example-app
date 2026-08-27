# openai-otel-js-example-app

An example app demonstrating **automatic OpenTelemetry instrumentation** of the OpenAI Node SDK, with traces exported to Honeycomb. It's a documentation/demo artifact — one command (`npm start`) runs five scenarios, each making a different kind of OpenAI API call, landing in Honeycomb as one connected trace you can inspect.

See [`SPEC.md`](./SPEC.md) for the full design rationale.

## What's automatic vs. what we added

The whole point of this app is showing the line between what `@opentelemetry/instrumentation-openai` (and the other instrumentation packages) give you automatically, and what still needs app code. `gen_ai.conversation.id` is the clearest case: Chat Completions has no field for it at all, so there's nothing for any instrumentation to surface — the app has to generate and carry it itself, or it just doesn't exist on the trace. Every row in the second table below exists for a similarly concrete reason, not because more manual tracing code is inherently better — each row says why, and later sections in this README go into more depth on the more involved ones.

**Automatic — zero app code, from the instrumentation packages alone:**

| Package | What it produces |
| --- | --- |
| `@opentelemetry/instrumentation-openai` (Chat Completions calls: `chat`, `streaming`, `tools`, `error`) | Span per call, named `{operation} {model}` (e.g. `chat gpt-4o-mini`), kind `CLIENT`. Attributes: `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.system`, whichever of `gen_ai.request.{temperature,top_p,frequency_penalty,presence_penalty,max_tokens,stop_sequences}` you passed, `gen_ai.response.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`, `gen_ai.usage.{input,output}_tokens`. Exception recording + `ERROR` span status on the deliberately-failing call (the `error` scenario). |
| `@opentelemetry/instrumentation-openai` (Embeddings calls: `embeddings`) | Same shape, embeddings-specific attributes (`gen_ai.request.encoding_formats`, etc.) instead of chat ones. |
| `@opentelemetry/instrumentation-http` + `@opentelemetry/instrumentation-express` (the weather tool call in `tools` only) | Standard HTTP client span (method, URL, status code) and Express server span (matched route, middleware), with no app code setting any of it. |

**Manually added, and why:**

| What | Why the instrumentation didn't cover it | Where |
| --- | --- | --- |
| `gen_ai.conversation.id` on every span | Only ever surfaced from the Responses API's native `conversation` object; Chat Completions has no such field, and correctly, nothing is synthesized in its place | `GenAIBaggageSpanProcessor` + Baggage, wired once in `run-scenario.ts` |
| `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` | `instrumentation-openai`'s Chat Completions path emits these as OTel **log records**, not span attributes (its Responses API path already does — `TODO(upstream)` in the code) | `setGenAIContent()` in `src/otel/genai-content.ts`, called from `chat.ts` + `tool-calling.ts` |
| `gen_ai.agent.name` + `gen_ai.operation.name` on an `invoke_agent {name}` span around each scenario — **optional**, see note below | Instrumentation only creates spans for the underlying API call itself — nothing represents "the agent" as its own span, which Honeycomb's Agent Timeline requires | `invokeAgent()` in `src/otel/invoke-agent-span.ts`, used by every scenario except `all.ts` |
| Redacting prompt content before Honeycomb | Not an instrumentation gap at all — an app-level policy decision about who sees raw content | `src/otel/content-redacting-span-processor.ts`, `telemetry.ts` |

## Setup

```bash
npm install
cp .env.example .env
# then edit .env: set OPENAI_API_KEY and HONEYCOMB_API_KEY
npm run build
```

## Running it

**`npm start` makes real, billable calls to the OpenAI API and sends real trace data to Honeycomb.** Don't run it without knowing that's what you're doing.

```bash
npm start
```

This runs all five scenarios (chat, streaming, embeddings, tool-calling, error-case) in sequence, wrapped in one manually-created root span (see the table above), so they land in Honeycomb as a single trace with five top-level operations instead of five unrelated ones.

Output prints to the console immediately (`ConsoleSpanExporter` runs on a `SimpleSpanProcessor`, so there's no batching delay) and also exports to Honeycomb over OTLP via a `BatchSpanProcessor` — the processor recommended for production, since it batches spans into fewer HTTP requests instead of issuing one per span. `telemetry.ts` still explicitly flushes both processors before the process exits, so nothing gets lost waiting for the batch's scheduled delay.

The tool-calling scenario is the one with a non-OpenAI span: its `get_weather` tool call is a real HTTP request (via `node:http`) to a tiny Express server started in-process for the run, so its trace shows `@opentelemetry/instrumentation-http` and `@opentelemetry/instrumentation-express` spans nested alongside the OpenAI ones — composing three separate auto-instrumentations in one trace.

## Making the Honeycomb Agent Timeline work

Honeycomb's [Agent Timeline guide](https://www.honeycomb.io/blog/instrumenting-ai-agents-agent-timeline-opentelemetry-guide) is explicit: every span needs `gen_ai.conversation.id`, `gen_ai.agent.name`, and `gen_ai.operation.name`, or a span renders as `"Unknown"` — which defeats the point. None of these are automatic for us:

- **`gen_ai.conversation.id`**: `instrumentation-openai` *does* set this — but only from OpenAI's Responses API `conversation` object on the response, never synthesizing one itself ([semantic-conventions-genai#410](https://github.com/open-telemetry/semantic-conventions-genai/pull/410) confirms this is intended: instrumentation surfaces a conversation id the app provides, it doesn't invent one). Chat Completions — what every scenario here uses — has no such field, so there's nothing for it to surface.
- **`gen_ai.agent.name`**: never set anywhere by `instrumentation-openai`, for either API — there's no concept of "an agent" at the level of a single Chat Completions call.
- **`gen_ai.operation.name`**: set automatically on the auto-instrumented `chat`/`embeddings` spans, but our own manually-created wrapper spans (see the table above) had nothing at all until now.

`src/otel/invoke-agent-span.ts`'s `invokeAgent(name, fn)` fixes all three: it runs `fn` inside a span named `invoke_agent {name}` (`gen_ai.operation.name: invoke_agent`), and puts `name` in Baggage alongside the conversation id `run-scenario.ts` already sets (`withNewConversation()`, `src/otel/conversation-context.ts`). `GenAIBaggageSpanProcessor` (`src/otel/genai-baggage-span-processor.ts`) reads both back out of Baggage and stamps them onto every span *as it starts* — including auto-instrumented ones, which manually calling `span.setAttribute()` after the fact can't reach (the same problem `genai-content.ts` ran into; same fix: intercept span creation itself instead of trying to reach a span after it's already gone).

Every scenario gets its own agent name (`chat-agent`, `streaming-agent`, `embeddings-agent`, `tool-calling-agent`, `error-agent`) rather than one shared name — so `npm start` demonstrates the Timeline's actual payoff: five differently-named agents inside one conversation, each getting their own swim lane. `all.ts`'s own wrapper span is instead named `invoke_workflow all scenarios` (`gen_ai.operation.name: invoke_workflow`), matching PR #410's extension of `gen_ai.conversation.id` to workflow-boundary spans that coordinate multiple agent invocations rather than being one themselves.

**`invokeAgent()` is optional.** It is *not* what keeps every scenario's spans in one trace — `all.ts`'s own `tracer.startActiveSpan('invoke_workflow all scenarios', ...)` already does that by itself, since `npm start` only ever runs through `all.ts`. Remove a scenario's `invokeAgent()` call and its auto-instrumented spans still land in the same trace, just as direct children of `all.ts`'s span instead of grandchildren — they'd only lose their own `gen_ai.agent.name` and `invoke_agent` span, i.e. their own row in the Agent Timeline. It's here purely to make that Timeline view show five distinct agents instead of one flat trace; drop it if you don't need per-agent swim lanes for your own use case.

## Keeping prompt content out of Honeycomb (optional)

`@opentelemetry/instrumentation-openai` doesn't capture Chat Completions message content as span attributes at all (it emits it as OTel log records instead — a different, unconfigured signal in this app; see the `TODO(upstream)` in `src/otel/genai-content.ts`). So `chat.ts` and `tool-calling.ts` set `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.tool.call.*` on their spans manually.

That content is always set — it's the export path, not the call site, that decides who sees it, per [Honeycomb's own split-export pattern](https://www.honeycomb.io/blog/instrumenting-ai-agents-agent-timeline-opentelemetry-guide) for keeping raw prompts out of a broadly-read observability backend:

- `src/otel/content-redacting-span-processor.ts` wraps the Honeycomb-bound processor and strips those content attributes before export — **on by default**. Set `OTEL_GENAI_CAPTURE_CONTENT=true` to disable it and send full content to Honeycomb too (e.g. local dev with no real user data).

The redactor never mutates the original span: `MultiSpanProcessor` calls every registered processor's `onEnd()` with the *same* span object, so deleting attributes in place would erase them for any other processor that also reads it — see the tests in `test/otel/content-redacting-span-processor.test.ts` for exactly this scenario. That property is also what makes it safe to add a second, unredacted destination later — see [`docs/optional-braintrust-export.md`](./docs/optional-braintrust-export.md) for a documented pattern to split-export full content to an eval platform, which isn't wired into this app by default.

## Testing

```bash
npm test
```

Smoke tests exercise each scenario's real logic (correct API call shape, correct handling of the response) against a local `http.createServer` fixture standing in for the OpenAI API — no real network calls, no API key spend.

**They do not verify real OTel instrumentation.** That's a deliberate, verified decision, not an oversight — see the "ESM instrumentation" section below.

## How the instrumentation actually works

This app compiles to ESM (`"type": "module"`). Under ESM, OTel's auto-instrumentation needs Node's `import-in-the-middle` loader hook active *before* the `openai` module is ever imported — ordinary import ordering in application code doesn't trigger it, unlike CommonJS `require`.

`src/telemetry.ts` handles this: it calls `register('@opentelemetry/instrumentation/hook.mjs', ...)` from `node:module`, then sets up the `NodeSDK` with `OpenAIInstrumentation`. It's loaded via `node --import ./dist/telemetry.js` in the `start` script — **never** via a regular `import` statement in application code, since that would run too late for the loader hook to intercept `openai`'s own module load, and would risk double-initializing the SDK.

This was verified empirically, not assumed: a manually-created span confirmed the SDK/exporter plumbing worked, and a real scenario run confirmed the instrumentation itself produces a span with correct `gen_ai.*` attributes — but only once `openai` was pinned to `^6.x`. `@opentelemetry/instrumentation-openai@0.19.0` only patches `openai` versions `>=4.19.0 <7`; the newer major (`7.x`, what npm resolves as "latest" as of this writing) silently produces zero spans with no error at all. Check that instrumentation package's supported-version range before ever bumping `openai`.

### Why the test suite doesn't verify spans

During implementation, the same `import-in-the-middle` patching that works cleanly in a real `node` process was confirmed **not** to intercept `openai` when loaded from inside a Vitest test — via two independent mechanisms (a `register()` call in a Vitest setup file, and passing the loader flag through Vitest's `execArgv`, the latter confirmed reaching the process but still producing no spans). This points to Vitest's own module runner not routing dependency imports through Node's native ESM loader chain — a structural incompatibility, not a config problem to fix.

So: smoke tests assert on **scenario logic** (the request sent to the fixture server has the right shape), and real instrumentation is verified exclusively by actually running `npm start` and checking the console/Honeycomb output.
