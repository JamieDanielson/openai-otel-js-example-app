import OpenAI from 'openai';
import { invokeAgent } from '../otel/invoke-agent-span.js';

export async function run(): Promise<void> {
  await invokeAgent('embeddings-agent', async () => {
    const client = new OpenAI();

    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'OpenTelemetry traces OpenAI calls.',
    });

    console.log(`Embedding vector length: ${response.data[0]?.embedding.length}`);
  });
}
