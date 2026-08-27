import express from 'express';
import type { AddressInfo } from 'node:net';

export interface WeatherServer {
  url: string;
  close: () => Promise<void>;
}

/** A tiny in-process Express server so the weather tool call is a real HTTP request, exercised by real HTTP/Express auto-instrumentation instead of a plain function call. */
export function startWeatherServer(): Promise<WeatherServer> {
  const app = express();

  app.get('/weather', (req, res) => {
    const location = typeof req.query.location === 'string' ? req.query.location : 'unknown';
    res.json({ location, condition: 'sunny', temperatureF: 72 });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
