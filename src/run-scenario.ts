import { run as chat } from './scenarios/chat.js';
import { run as streaming } from './scenarios/streaming.js';
import { run as embeddings } from './scenarios/embeddings.js';
import { run as toolCalling } from './scenarios/tool-calling.js';
import { run as errorCase } from './scenarios/error-case.js';
import { run as all } from './scenarios/all.js';
import { withNewConversation } from './otel/conversation-context.js';

const scenarios: Record<string, () => Promise<void>> = {
  chat,
  streaming,
  embeddings,
  tools: toolCalling,
  error: errorCase,
  all,
};

const name = process.argv[2];
const scenario = name ? scenarios[name] : undefined;

if (!scenario) {
  console.error(`Unknown scenario "${name}". Available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

try {
  // One conversation id per invocation, so every span this scenario produces
  // — including auto-instrumented ones — carries the same gen_ai.conversation.id.
  await withNewConversation(() => scenario());
} catch (err) {
  // Top-level await rejections in an ESM entry module bypass the
  // 'unhandledRejection' event entirely, so this catch is the only
  // place that can let the process exit naturally (via exitCode,
  // not process.exit) and let telemetry's 'beforeExit' handler flush spans.
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
