import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../support/fixture-server.js';
import { run } from '../../src/scenarios/all.js';

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
  sseChunk({ role: 'assistant', content: 'Hello' }) + sseChunk({}, 'stop') + 'data: [DONE]\n\n';

describe('all scenarios', () => {
  let server: FixtureServer;

  beforeEach(async () => {
    server = await startFixtureServer((path, body) => {
      if (path.includes('/embeddings')) {
        return {
          status: 200,
          body: {
            object: 'list',
            data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 5, total_tokens: 5 },
          },
        };
      }

      if (!path.includes('/chat/completions')) {
        return { status: 404, body: { error: { message: 'not found' } } };
      }

      const requestBody = body as {
        model?: string;
        stream?: boolean;
        tools?: unknown;
        messages: Array<{ role: string }>;
      };

      if (requestBody.model === 'not-a-real-model') {
        return {
          status: 400,
          body: {
            error: {
              message: 'The model `not-a-real-model` does not exist or you do not have access to it.',
              type: 'invalid_request_error',
              param: null,
              code: 'model_not_found',
            },
          },
        };
      }

      if (requestBody.stream) {
        return { status: 200, body: SSE_BODY, contentType: 'text/event-stream', raw: true };
      }

      if (requestBody.tools) {
        return {
          status: 200,
          body: {
            id: 'chatcmpl-test-1',
            object: 'chat.completion',
            created: 0,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'get_weather', arguments: '{"location":"Boston"}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          },
        };
      }

      const hasToolResult = requestBody.messages.some((message) => message.role === 'tool');
      if (hasToolResult) {
        return {
          status: 200,
          body: {
            id: 'chatcmpl-test-2',
            object: 'chat.completion',
            created: 0,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: "It's sunny and 72°F in Boston." },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          },
        };
      }

      return {
        status: 200,
        body: {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello there!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      };
    });
    process.env.OPENAI_BASE_URL = server.url;
  });

  afterEach(async () => {
    delete process.env.OPENAI_BASE_URL;
    await server.close();
  });

  it('runs every scenario in sequence under one root span', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await run();

    // chat + streaming + embeddings + tool-calling (2 requests) + error = 6
    expect(server.hitCount()).toBe(6);

    logSpy.mockRestore();
  });
});
