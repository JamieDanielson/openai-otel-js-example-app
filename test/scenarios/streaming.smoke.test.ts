import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../support/fixture-server.js';
import { run } from '../../src/scenarios/streaming.js';

function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-4o-mini',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

const SSE_BODY =
  sseChunk({ role: 'assistant', content: 'Hello' }) +
  sseChunk({ content: ' there!' }) +
  sseChunk({}, 'stop') +
  'data: [DONE]\n\n';

describe('streaming scenario', () => {
  let server: FixtureServer;

  beforeEach(async () => {
    server = await startFixtureServer((path) => {
      if (path.includes('/chat/completions')) {
        return { status: 200, body: SSE_BODY, contentType: 'text/event-stream', raw: true };
      }
      return { status: 404, body: { error: { message: 'not found' } } };
    });
    process.env.OPENAI_BASE_URL = server.url;
  });

  afterEach(async () => {
    delete process.env.OPENAI_BASE_URL;
    await server.close();
  });

  it('sends a streaming chat completion request with stream: true', async () => {
    await run();

    expect(server.hitCount()).toBe(1);
    const [request] = server.requests();
    expect(request.path).toContain('/chat/completions');
    expect(request.body).toMatchObject({
      model: 'gpt-4o-mini',
      stream: true,
    });
  });
});
