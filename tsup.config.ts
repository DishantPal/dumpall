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
  // These packages have native deps or complex sub-dependency trees that
  // can't be bundled cleanly — load them from node_modules at runtime.
  external: [
    'jsdom',
    '@mozilla/readability',
    'turndown',
    'unzipper',
    '@clack/prompts',
    '@aws-sdk/client-s3',
  ],
  noExternal: [],
});
