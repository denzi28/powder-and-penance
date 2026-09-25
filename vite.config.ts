import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative paths, so the build also runs from disk (the desktop app)
  server: { port: 5173 },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'] },
});
