import OpenAI from 'openai';
import { invokeAgent } from '../otel/invoke-agent-span.js';

export async function run(): Promise<void> {
  await invokeAgent('streaming-agent', async () => {
    const client = new OpenAI();

    const stream = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Count from one to five.' }],
      stream: true,
    });

    let text = '';
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content ?? '';
    }

    console.log(text);
  });
}
