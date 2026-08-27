import { run } from './scenarios/all.js';
import { withNewConversation } from './otel/conversation-context.js';

try {
  // One conversation id per run, so every span this produces — including
  // auto-instrumented ones — carries the same gen_ai.conversation.id.
  await withNewConversation(() => run());
} catch (err) {
  // Top-level await rejections in an ESM entry module bypass the
  // 'unhandledRejection' event entirely, so this catch is the only
  // place that can let the process exit naturally (via exitCode,
  // not process.exit) and let telemetry's 'beforeExit' handler flush spans.
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
