const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ESC = '\x1b';
const CLEAR = `\r${ESC}[K`;

export interface Spinner {
  update(msg: string): void;
  done(msg: string): void;
  fail(msg: string): void;
}

export function spinner(initial: string): Spinner {
  let msg = initial;
  let frame = 0;
  const isTTY = process.stderr.isTTY;

  if (!isTTY) {
    process.stderr.write(`${initial}\n`);
  } else {
    process.stderr.write(`${FRAMES[0]} ${msg}`);
  }

  const timer = isTTY
    ? setInterval(() => {
        frame = (frame + 1) % FRAMES.length;
        process.stderr.write(`${CLEAR}${FRAMES[frame]} ${msg}`);
      }, 80)
    : null;

  function stop() {
    if (timer) clearInterval(timer);
  }

  return {
    update(newMsg: string) {
      msg = newMsg;
      if (!isTTY) process.stderr.write(`${newMsg}\n`);
    },
    done(newMsg: string) {
      stop();
      if (isTTY) process.stderr.write(`${CLEAR}✓ ${newMsg}\n`);
      else process.stderr.write(`✓ ${newMsg}\n`);
    },
    fail(newMsg: string) {
      stop();
      if (isTTY) process.stderr.write(`${CLEAR}✗ ${newMsg}\n`);
      else process.stderr.write(`✗ ${newMsg}\n`);
    },
  };
}
