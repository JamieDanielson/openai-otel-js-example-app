import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      OPENAI_API_KEY: 'test-key-not-real',
    },
  },
});
