# openai-otel-js-example-app — Spec

## Objective

A small example application demonstrating **automatic OpenTelemetry instrumentation** of the OpenAI Node SDK using `@opentelemetry/instrumentation-openai`, with traces exported via OTLP to Honeycomb. The app is a documentation/demo artifact, not a production service: its job is to show, with minimal manual tracing code, what GenAI semantic-convention spans look like for several distinct OpenAI API call shapes.

Non-goals: no persistent or externally-reachable HTTP server, no persistence layer, no UI. Nothing beyond running `npm start` and inspecting the resulting trace. (The tool-calling scenario does start a tiny, loopback-only, in-process Express server for the duration of that one scenario — see Project Structure — solely so its tool call is a real HTTP request the HTTP/Express instrumentation can pick up. That's the one deliberate exception; it isn't a service.)

## Assumptions

1. **Module system**: ESM (`"type": "module"` in package.json). Per [OTel JS's ESM support doc](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md), ESM auto-instrumentation needs the `import-in-the-middle` loader hook active before `openai` is imported — plain import ordering inside application code does **not** trigger instrumentation patching under ESM, unlike CommonJS `require`. `instrumentation-openai`'s own README only documents the CJS `require`-based setup; the ESM loader-hook path is explicitly called out upstream as less-documented. **Verified working**, using `node:module`'s `register('@opentelemetry/instrumentation/hook.mjs', ...)` called directly inside `telemetry.ts`, loaded via a single `--import ./dist/telemetry.js` flag — no separate `--experimental-loader` CLI flag needed.
2. `@opentelemetry/instrumentation-openai` (npm, latest `0.19.0`) is the target package. Verified it exists, requires `@opentelemetry/api ^1.3.0` as a peer dep, and needs Node `^18.19.0 || >=20.6.0` (satisfied by Node 22).
3. OpenAI SDK version: **pinned to `openai@^6.x` (`<7`), not "latest."** `@opentelemetry/instrumentation-openai@0.19.0` gates its patch to `openai` versions `>=4.19.0 <7` (`InstrumentationNodeModuleDefinition('openai', ['>=4.19.0 <7'], ...)`); outside that range the instrumentation silently no-ops with zero spans and no error or warning. Verified empirically: `openai@7.5.0` (npm's "latest" at implementation time) produced no spans at all; downgrading to `openai@6.49.0` (latest release still `<7`) fixed it immediately, confirmed via a real span with correct `gen_ai.*` attributes. Any future `openai` major bump must first check this instrumentation package's supported-version range before upgrading.
4. Honeycomb OTLP endpoint: `https://api.honeycomb.io` (classic) via `OTEL_EXPORTER_OTLP_ENDPOINT` + `x-honeycomb-team` header, not the EU endpoint — flag if you're on Honeycomb EU.

→ Correct any of these now or I'll proceed with them.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript (`tsc`) to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run smoke tests (Vitest) against in-memory span exporter |
| `npm start` | Run all five scenarios (chat, streaming, embeddings, tool-calling, error-case) in sequence, as one connected trace |

The `start` script requires `OPENAI_API_KEY` and `HONEYCOMB_API_KEY` to be set (via `.env`, loaded through `dotenv`). **Before running `npm start`, ask for explicit confirmation** — it makes real, billable OpenAI API calls and sends real trace data to Honeycomb.

The `start` script invokes `node` with `--import`, preloading compiled telemetry setup (which calls `register()` itself — see Assumptions #1) before any scenario code, and therefore before `openai` itself, is imported:

```bash
node --import ./dist/telemetry.js dist/run-scenario.js
```

i.e. `"start": "node --import ./dist/telemetry.js dist/run-scenario.js"`.

## Project Structure

```
.
├── SPEC.md
├── README.md                 # per-file breakdown of src/, and what's automatic vs. manually added
├── docs/                     # optional, undeployed integration patterns (e.g. Braintrust split-export)
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── src/
│   ├── telemetry.ts          # NodeSDK setup: instrumentation registration + OTLP export to Honeycomb
│   ├── otel/                 # cross-cutting OTel helpers shared by every scenario (see README)
│   ├── scenarios/            # one file per OpenAI API call shape, plus all.ts
│   └── run-scenario.ts       # thin CLI entry: runs all scenarios via scenarios/all.ts
└── test/
    ├── support/               # test-only fixtures (e.g. a local http server standing in for the OpenAI API)
    └── scenarios/ + otel/     # smoke tests, one per scenario + one per otel/ helper
```

README.md is the source of truth for the exact file list and what each one does — don't duplicate that list here; update README.md when files are added or renamed.

Key constraint: `telemetry.ts` calls `register('@opentelemetry/instrumentation/hook.mjs', ...)` and `sdk.start()` as top-level side effects, and is loaded **only** via the `--import ./dist/telemetry.js` Node flag (see Commands), never via a regular `import` statement in `run-scenario.ts` or any scenario file. Under ESM, instrumentation patching happens through that loader hook intercepting module loads at the runtime level — a regular in-code `import telemetry.ts` before `import 'openai'` does **not** achieve the same effect and must not be relied on. `run-scenario.ts` importing `telemetry.ts` directly would also risk double-initializing the SDK (once via `--import`, once via the regular import), so it's left out entirely.

## Code Style

- TypeScript, strict mode (`strict: true` in tsconfig), ESM (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`).
- No classes for the scenario scripts — each is a single exported async function (`export async function run(): Promise<void>`) with no framework abstraction.
- No comments explaining *what* the OpenAI/OTel calls do (the SDK names already say that); a comment is only warranted for the load-order constraint above, since that's a non-obvious invariant.
- Environment variables read in exactly one place (`src/telemetry.ts` for OTel/Honeycomb config, each scenario file for `OPENAI_API_KEY` via the `openai` client's own env var default) — no scattered `process.env` reads.
- Never log or print full API key values, in code or in example output.

## Testing Strategy

Smoke tests only (Vitest), scenario **logic** only — no span/instrumentation assertions in the automated suite:

- **Do not `vi.mock('openai')`.** Vitest's module mocking substitutes a mock before Node's real module-loading pipeline ever runs, so ESM loader-hook-based patching never sees a real load event to intercept — a test built on `vi.mock('openai')` would only assert facts about a mock object, proving nothing about whether the real auto-instrumentation works.
- Instead: import the **real** `openai` module in tests and fake only the HTTP transport via a local `http.createServer` fixture server (`test/support/fixture-server.ts`), pointing the client at it via the `OPENAI_BASE_URL` env var (which the `openai` SDK reads natively) — no changes needed to scenario source to make it testable. No new dependency required.
- **Real OTel auto-instrumentation is not verified in the automated test suite at all**, and this is a deliberate, verified conclusion, not an oversight: `import-in-the-middle`-based patching is confirmed working in a plain `node` process, but confirmed **not** intercepting inside Vitest via two independent mechanisms — a programmatic `register()` call in a `setupFiles` module, and passing `--experimental-loader` through Vitest's `execArgv` (verified reaching the forked process via its own experimental-warning output) — both produced zero captured spans. This points to Vitest's own module runner not routing dependency imports through Node's native ESM loader chain, a structural incompatibility rather than a config problem. Real instrumentation is verified exclusively by actually running `npm start` (ask-first, per Commands) and checking the console/Honeycomb output.
- Each scenario's smoke test asserts on **fixture-server-observed request shape** (correct path, model, message/parameter structure) — i.e. that the scenario calls the OpenAI API correctly and handles the response — not on telemetry output.
- No integration test against the real OpenAI API — scenario scripts themselves serve as the manual/opt-in integration and instrumentation check (per the confirm-before-running rule above).

## Boundaries

**Always do:**

- Load `OPENAI_API_KEY` and `HONEYCOMB_API_KEY` from a git-ignored `.env` file (via `dotenv`); commit only `.env.example` with placeholder values.
- Keep the `start` script invoking `node --import ./dist/telemetry.js` — never add a scenario runner that skips it or relies on in-code import ordering instead.
- Add a corresponding smoke test when adding a new scenario file.

**Ask first about:**

- Running `npm start` (real OpenAI API calls + real Honeycomb export — costs money and sends live data).
- Adding new dependencies beyond `openai`, `@opentelemetry/*` packages, `express` (used only for the in-process demo server described in Non-goals), `dotenv`, and the test runner.
- Changing the OTLP endpoint or exporter configuration (e.g. switching to console exporter, changing Honeycomb region).

**Never do:**

- Commit `.env`, real API keys, or Honeycomb team names/keys in any file.
- Print full API key values to stdout/stderr in scenario output or logs.
- Add a persistence layer, a persistent or externally-reachable HTTP server, or a UI — this stays a script-based example app. (The one exception is already in the repo — see Non-goals.)
