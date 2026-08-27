import OpenAI from 'openai';
import { invokeAgent } from '../otel/invoke-agent-span.js';

export async function run(): Promise<void> {
  await invokeAgent('error-agent', async () => {
    const client = new OpenAI();

    try {
      await client.chat.completions.create({
        model: 'not-a-real-model',
        messages: [{ role: 'user', content: 'This request is expected to fail.' }],
      });
    } catch (err) {
      console.log(`Request failed as expected: ${err instanceof Error ? err.message : err}`);
    }
  });
}
