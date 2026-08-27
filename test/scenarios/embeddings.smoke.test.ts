import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../support/fixture-server.js';
import { run } from '../../src/scenarios/embeddings.js';

describe('embeddings scenario', () => {
  let server: FixtureServer;

  beforeEach(async () => {
    server = await startFixtureServer((path) => {
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
      return { status: 404, body: { error: { message: 'not found' } } };
    });
    process.env.OPENAI_BASE_URL = server.url;
  });

  afterEach(async () => {
    delete process.env.OPENAI_BASE_URL;
    await server.close();
  });

  it('sends an embeddings request with the expected model and input', async () => {
    await run();

    expect(server.hitCount()).toBe(1);
    const [request] = server.requests();
    expect(request.path).toContain('/embeddings');
    expect(request.body).toMatchObject({
      model: 'text-embedding-3-small',
      input: expect.any(String),
    });
  });
});
