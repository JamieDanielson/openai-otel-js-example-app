import http from 'node:http';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { startWeatherServer } from './weather-server.js';
import { setGenAIContent } from '../otel/genai-content.js';
import { invokeAgent } from '../otel/invoke-agent-span.js';

// A real HTTP call (via node:http, which @opentelemetry/instrumentation-http
// patches) to a local Express server, so this scenario's trace also shows
// HTTP client/server spans alongside the OpenAI ones.
function getWeather(baseUrl: string, location: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL('/weather', baseUrl);
    url.searchParams.set('location', location);
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

export async function run(): Promise<void> {
  const weatherServer = await startWeatherServer();
  try {
    // Both chat.completions.create calls below need to run inside one active
    // span so the auto-instrumented spans they produce share a trace ID
    // instead of each starting its own root trace.
    await invokeAgent('tool-calling-agent', () => runToolCallingRoundTrip(weatherServer.url));
  } finally {
    await weatherServer.close();
  }
}

async function runToolCallingRoundTrip(weatherServerUrl: string): Promise<void> {
  const client = new OpenAI();

  const tools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
          },
          required: ['location'],
        },
      },
    },
  ];

  const messages: ChatCompletionMessageParam[] = [
    { role: 'user', content: 'What is the weather in Boston?' },
  ];
  setGenAIContent({ 'gen_ai.input.messages': messages });

  const first = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    tools,
  });

  const message = first.choices[0]?.message;
  const toolCalls = message?.tool_calls?.filter((call) => call.type === 'function') ?? [];

  if (toolCalls.length === 0) {
    console.log(message?.content ?? 'No tool calls requested.');
    return;
  }

  messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: message?.tool_calls });

  for (const call of toolCalls) {
    const { location } = JSON.parse(call.function.arguments) as { location: string };
    setGenAIContent({ 'gen_ai.tool.call.arguments': call.function.arguments });
    const weather = await getWeather(weatherServerUrl, location);
    setGenAIContent({ 'gen_ai.tool.call.result': weather });
    messages.push({ role: 'tool', tool_call_id: call.id, content: weather });
  }

  // A separate call carries the tool's result back to the model, so this
  // scenario's trace shows two chained gen_ai spans instead of one.
  const second = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
  });

  setGenAIContent({ 'gen_ai.output.messages': second.choices.map((choice) => choice.message) });
  console.log(second.choices[0]?.message?.content);
}
