import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  path: string;
  body: unknown;
}

export interface FixtureResponse {
  status: number;
  /** JSON-serialized unless `raw` is true. */
  body: unknown;
  contentType?: string;
  /** When true, `body` must be a string and is written as-is (e.g. pre-framed SSE). */
  raw?: boolean;
}

export interface FixtureServer {
  url: string;
  hitCount: () => number;
  requests: () => ReceivedRequest[];
  close: () => Promise<void>;
}

export function startFixtureServer(
  handler: (path: string, body: unknown) => FixtureResponse,
): Promise<FixtureServer> {
  const requests: ReceivedRequest[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : undefined;
      const path = req.url ?? '/';
      requests.push({ path, body });
      const response = handler(path, body);
      res.writeHead(response.status, { 'content-type': response.contentType ?? 'application/json' });
      res.end(response.raw ? (response.body as string) : JSON.stringify(response.body));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        hitCount: () => requests.length,
        requests: () => requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
