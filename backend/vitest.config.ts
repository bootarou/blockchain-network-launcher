import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // server.ts starts an HTTP server on import, so only the modules that are
    // safe to import in isolation are collected.
    include: ['beacon.test.ts'],
    environment: 'node',
  },
});
