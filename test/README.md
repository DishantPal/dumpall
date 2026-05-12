# dumpall

[![npm version](https://img.shields.io/npm/v/dumpall.svg)](https://www.npmjs.com/package/dumpall)

A smart CLI utility to aggregate file contents into a single, clean output, perfect for AI context, code reviews, or archiving.



`dumpall` recursively reads files in a directory, filters out unwanted items, and formats the output as clean, LLM-friendly Markdown code blocks.

---

## ✨ Features

-   **LLM-Optimized Output**: Formats all content into unambiguous Markdown fenced code blocks.
-   **Clipboard Integration**: Use the `--clip` flag to copy the entire output directly to your clipboard.
-   **Cross-Platform Support**: Works on macOS, Linux (X11/Wayland), and Windows (via Git Bash/WSL).
-   **Colorized Output**: An optional `--color` flag for improved readability in the terminal.
-   **Smart Exclusions**: Easily exclude common directories like `node_modules` or `.git`.
-   **Live Progress Spinner**: A dynamic progress indicator shows the script is working, which can be disabled for CI environments.
-   **Safe & Robust**: Handles filenames with spaces or special characters and provides helpful error messages.

---

## 🚀 Usage

No permanent installation is needed! The easiest way to use `dumpall` is with `npx`:

```bash
npx dumpall <path> [options]
```

---

## ⚙️ Options

| Flag              | Alias | Description                                        |
| ----------------- | ----- | -------------------------------------------------- |
| `--exclude <name>`  | `-e`  | Exclude files or directories by name. Use multiple times for multiple exclusions. |
| `--clip`          | `-c`  | Copy the output directly to the clipboard.         |
| `--color`         |       | Enable colorized output for terminal display.      |
| `--no-progress`   |       | Disable the progress spinner animation.            |
| `--version`       | `-v`  | Show the current version.                          |
| `--help`          | `-h`  | Show the help message.                             |

### Environment Variables

-   `DUMPALL_CLIP_CMD`: Allows you to override the default clipboard command (e.g., `DUMPALL_CLIP_CMD="my-clip-tool" dumpall . -c`).

---

## 💡 Examples

**Dump the current directory, excluding `node_modules` and `.git`:**
```bash
npx dumpall . -e node_modules -e .git
```

**Dump the `src` directory and copy it to the clipboard:**
```bash
npx dumpall ./src --clip
```

**Dump a single file with colorized output:**
```bash
npx dumpall package.json --color
```

---

### A Note for Windows Users

`dumpall` is a Bash script and requires a Unix-like environment to run. We recommend using **Git Bash** (which comes with Git for Windows) or **WSL** for the best experience.

---

## 📄 License

Licensed under the MIT License.