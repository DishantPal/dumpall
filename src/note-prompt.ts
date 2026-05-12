const ESC = '\x1b';
const UP = (n: number) => `${ESC}[${n}A`;
const CLEAR_LINE = `${ESC}[2K\r`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
const RESET = `${ESC}[0m`;
const SHOW_CURSOR = `${ESC}[?25h`;
const HIDE_CURSOR = `${ESC}[?25l`;

export async function promptNote(): Promise<string> {
  return new Promise((resolve) => {
    const out = process.stdout;
    const inp = process.stdin;

    if (!inp.isTTY || !out.isTTY) {
      // Non-TTY: just read from stdin until EOF
      let data = '';
      inp.setEncoding('utf8');
      inp.on('data', (chunk: string) => { data += chunk; });
      inp.on('end', () => resolve(data.trim()));
      return;
    }

    const lines: string[] = [''];
    let linesDrawn = 0;
    let initialized = false;

    inp.setRawMode(true);
    inp.resume();
    inp.setEncoding('utf8');
    out.write(HIDE_CURSOR);

    function render() {
      const cols = out.columns ?? 80;
      const border = `  ${DIM}│${RESET} `;
      const header = `  ${CYAN}╭─ Note (Ctrl+D to submit, Ctrl+C to cancel) ${'─'.repeat(Math.max(0, cols - 47))}${RESET}`;

      const outputLines: string[] = [header];
      for (const line of lines) {
        outputLines.push(`${border}${line}`);
      }
      // Empty line at bottom to show cursor position
      const footer = `  ${DIM}╰${'─'.repeat(Math.max(0, cols - 4))}${RESET}`;
      outputLines.push(footer);

      if (!initialized) {
        out.write('\r\n'.repeat(outputLines.length));
        out.write(UP(outputLines.length));
        initialized = true;
      } else {
        out.write(UP(linesDrawn));
      }

      for (const l of outputLines) {
        out.write(`${CLEAR_LINE}${l}\r\n`);
      }
      linesDrawn = outputLines.length;
    }

    function cleanup() {
      inp.setRawMode(false);
      inp.pause();
      inp.removeAllListeners('data');
      out.write(SHOW_CURSOR);
      // Clear the prompt area
      out.write(UP(linesDrawn));
      for (let i = 0; i < linesDrawn; i++) out.write(`${CLEAR_LINE}\r\n`);
      out.write(UP(linesDrawn));
    }

    render();

    inp.on('data', (key: string) => {
      // Ctrl+C
      if (key === '\x03') {
        cleanup();
        process.exit(0);
      }

      // Ctrl+D — submit
      if (key === '\x04') {
        cleanup();
        resolve(lines.join('\n'));
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        const lastLine = lines[lines.length - 1];
        if (lastLine.length > 0) {
          lines[lines.length - 1] = lastLine.slice(0, -1);
        } else if (lines.length > 1) {
          lines.pop();
        }
        render();
        return;
      }

      // Enter (newline)
      if (key === '\r' || key === '\n') {
        lines.push('');
        render();
        return;
      }

      // Regular printable characters
      if (key.length === 1 && key >= ' ') {
        lines[lines.length - 1] += key;
        render();
        return;
      }

      // Multi-char sequences (e.g. escape codes from arrow keys) — ignore
    });
  });
}
