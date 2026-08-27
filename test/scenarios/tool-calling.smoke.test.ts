import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../support/fixture-server.js';
import { run } from '../../src/scenarios/tool-calling.js';

describe('tool-calling scenario', () => {
  let server: FixtureServer;

  beforeEach(async () => {
    server = await startFixtureServer((path, body) => {
      if (!path.includes('/chat/completions')) {
        return { status: 404, body: { error: { message: 'not found' } } };
      }

      const messages = (body as { messages: Array<{ role: string }> }).messages;
      const hasToolResult = messages.some((message) => message.role === 'tool');

      if (!hasToolResult) {
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
    });
    process.env.OPENAI_BASE_URL = server.url;
  });

  afterEach(async () => {
    delete process.env.OPENAI_BASE_URL;
    await server.close();
  });

  it('executes the tool and sends its result back for a final answer', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await run();

    expect(server.hitCount()).toBe(2);
    const [firstRequest, secondRequest] = server.requests();
    expect(firstRequest.path).toContain('/chat/completions');
    expect(firstRequest.body).toMatchObject({
      model: 'gpt-4o-mini',
      tools: [{ type: 'function', function: { name: 'get_weather' } }],
    });

    const secondBody = secondRequest.body as { messages: Array<{ role: string; content?: string }> };
    const toolMessage = secondBody.messages.find((message) => message.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.content).toContain('Boston');

    expect(logSpy).toHaveBeenCalledWith("It's sunny and 72°F in Boston.");

    logSpy.mockRestore();
  });
});
