import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../support/fixture-server.js';
import { run } from '../../src/scenarios/chat.js';

describe('chat scenario', () => {
  let server: FixtureServer;

  beforeEach(async () => {
    server = await startFixtureServer((path) => {
      if (path.includes('/chat/completions')) {
        return {
          status: 200,
          body: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 0,
            model: 'gpt-4o-mini',
            choices: [
              { index: 0, message: { role: 'assistant', content: 'Hello there!' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        };
      }
      return { status: 404, body: { error: { message: 'not found' } } };
    });
    process.env.OPENAI_BASE_URL = server.url;
  });

  afterEach(async () => {
    delete process.env.OPENAI_BASE_URL;
    await server.close();
  });

  it('sends a chat completion request with the expected model and messages', async () => {
    await run();

    expect(server.hitCount()).toBe(1);
    const [request] = server.requests();
    expect(request.path).toContain('/chat/completions');
    expect(request.body).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: expect.any(String) }],
    });
  });
});
