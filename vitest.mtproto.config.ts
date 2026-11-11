import { defineConfig } from 'vitest/config';

// Transport tests need no application bundle, static assets, or login session.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/lib/gramjs/extensions/PromisedWebSockets.test.ts'],
  },
});
