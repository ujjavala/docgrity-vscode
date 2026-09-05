import { defineConfig } from 'vitest/config';

// action/ is a zero-dependency package tested with node:test (`cd action && npm test`);
// vitest covers the extension sources only.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'action/**', 'out/**'],
  },
});
