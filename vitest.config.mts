import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
  },
  resolve: {
    alias: { vscode: path.resolve(__dirname, 'test/vscode-stub.ts') },
  },
});
