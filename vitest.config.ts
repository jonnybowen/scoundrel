import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Rules tests run headless in Node: src/game is DOM-free by contract.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
