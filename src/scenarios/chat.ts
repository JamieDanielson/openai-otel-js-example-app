import OpenAI from 'openai';
import { setGenAIContent } from '../otel/genai-content.js';
import { invokeAgent } from '../otel/invoke-agent-span.js';

export async function run(): Promise<void> {
  await invokeAgent('chat-agent', async () => {
    const client = new OpenAI();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Say hello in exactly five words.' },
    ];
    setGenAIContent({ 'gen_ai.input.messages': messages });

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    setGenAIContent({ 'gen_ai.output.messages': completion.choices.map((choice) => choice.message) });
    console.log(completion.choices[0]?.message?.content);
  });
}
