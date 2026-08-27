import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../support/fixture-server.js';
import { run } from '../../src/scenarios/error-case.js';

describe('error-case scenario', () => {
  let server: FixtureServer;

  beforeEach(async () => {
    server = await startFixtureServer((path) => {
      if (path.includes('/chat/completions')) {
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
      return { status: 404, body: { error: { message: 'not found' } } };
    });
    process.env.OPENAI_BASE_URL = server.url;
  });

  afterEach(async () => {
    delete process.env.OPENAI_BASE_URL;
    await server.close();
  });

  it('catches the API error itself and does not throw', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(run()).resolves.toBeUndefined();

    expect(server.hitCount()).toBe(1);
    const [request] = server.requests();
    expect(request.body).toMatchObject({ model: 'not-a-real-model' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Request failed as expected'));

    logSpy.mockRestore();
  });
});
