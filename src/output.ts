import fs from 'node:fs';
import clipboard from 'clipboardy';
import { estimateTokens } from './tokens.js';
import { shareContent } from './share.js';

export interface OutputOptions {
  clip?: boolean;
  outFile?: string;
  showTokens?: boolean;
  qr?: boolean;
  share?: boolean;
}

export async function writeOutput(content: string, opts: OutputOptions): Promise<void> {
  if (opts.qr) {
    // Upload content, generate QR of the short URL — always tiny and scannable
    const url = await shareContent(content);
    const qrcode = await import('qrcode-terminal');
    qrcode.default.generate(url, { small: true });
    process.stderr.write(`  ${url}\n`);
    if (opts.showTokens) {
      const n = estimateTokens(content);
      process.stderr.write(`✓ ~${n} tokens\n`);
    }
    return;
  }

  if (opts.share) {
    const url = await shareContent(content);
    process.stdout.write(url + '\n');
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
