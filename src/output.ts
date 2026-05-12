import fs from 'node:fs';
import clipboard from 'clipboardy';
import { estimateTokens } from './tokens.js';

export interface OutputOptions {
  clip?: boolean;
  outFile?: string;
  showTokens?: boolean;
  qr?: boolean;
}

const QR_MAX_CHARS = 2900;

export async function writeOutput(content: string, opts: OutputOptions): Promise<void> {
  if (opts.qr) {
    if (content.length > QR_MAX_CHARS) {
      process.stderr.write(
        `✗ Content too large for QR code (${content.length} chars, max ~${QR_MAX_CHARS}).\n` +
        `  Try --tree-only or --max-tokens to shrink output.\n`,
      );
      process.exit(1);
    }
    // Dynamic import to avoid loading at startup
    const qrcode = await import('qrcode-terminal');
    qrcode.default.generate(content, { small: true });
    if (opts.showTokens) {
      const n = estimateTokens(content);
      process.stderr.write(`✓ ~${n} tokens\n`);
    }
    return;
  }

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
