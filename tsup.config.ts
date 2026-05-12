import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  minify: true,
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
