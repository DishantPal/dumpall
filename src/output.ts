import fs from 'node:fs';
import clipboard from 'clipboardy';
import { estimateTokens } from './tokens.js';

export interface OutputOptions {
  clip?: boolean;
  outFile?: string;
  showTokens?: boolean;
  qr?: boolean;
}

// Binary-mode capacity (ECC L) per QR version 1-40.
// With small:true each module = 1 terminal column, QR version V = (4V+17) modules wide.
const QR_BINARY_CAPACITY = [
  0,17,32,53,78,106,134,154,192,230,271,321,367,425,458,520,586,644,718,792,
  858,929,1003,1091,1171,1273,1367,1465,1528,1628,1732,1840,1952,2068,2188,
  2303,2431,2563,2699,2809,2953,
];

function qrMaxChars(): number {
  // Leave 4 cols of quiet-zone margin on each side
  const termCols = process.stdout.columns ?? 80;
  const maxModules = termCols - 8;
  // QR version V has (4V+17) modules → V = (modules-17)/4
  const maxVersion = Math.max(1, Math.min(40, Math.floor((maxModules - 17) / 4)));
  return QR_BINARY_CAPACITY[maxVersion] ?? 300;
}

export async function writeOutput(content: string, opts: OutputOptions): Promise<void> {
  if (opts.qr) {
    const maxChars = qrMaxChars();
    if (content.length > maxChars) {
      process.stderr.write(
        `✗ Content too large for QR code (${content.length} chars, max ~${maxChars} for your terminal width).\n` +
        `  Try --tree-only or --max-tokens ${maxChars} to shrink output.\n`,
      );
      process.exit(1);
    }
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
