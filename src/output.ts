import fs from 'node:fs';
import clipboard from 'clipboardy';
import { estimateTokens } from './tokens.js';

export interface OutputOptions {
  clip?: boolean;
  outFile?: string;
  showTokens?: boolean;
}

export async function writeOutput(content: string, opts: OutputOptions): Promise<void> {
  if (opts.clip) {
    await clipboard.write(content);
    process.stderr.write('✓ Copied to clipboard\n');
  } else if (opts.outFile) {
    fs.writeFileSync(opts.outFile, content, 'utf8');
    process.stderr.write(`✓ Written to ${opts.outFile}\n`);
  } else {
    process.stdout.write(content);
  }

  if (opts.showTokens) {
    const n = estimateTokens(content);
    process.stderr.write(`✓ ~${n} tokens\n`);
  }
}
