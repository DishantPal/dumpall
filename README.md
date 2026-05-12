# dumpall

[![npm version](https://img.shields.io/npm/v/dumpall.svg)](https://www.npmjs.com/package/dumpall)

**The universal context compiler. Everything into one document. Instantly.**

Feed files, folders, URLs, or entire GitHub repos to dumpall — get back one clean, structured document ready to paste into any LLM.

```bash
npx dumpall src/
npx dumpall github.com/owner/repo
npx dumpall "https://docs.example.com/**"
```

---

## Features

- **Multiple sources** — local paths, HTTP/S URLs, GitHub/GitLab/Bitbucket repos, URL globs via sitemap
- **Output formats** — Markdown (default), XML, JSON
- **Interactive file picker** — fuzzy-search and select files with `@`
- **Clipboard, file, share** — `-c` to copy, `-o` to write, `--share` for a public URL, `--qr` for a scannable QR code
- **Token awareness** — `--tokens` to estimate, `--max-tokens` to trim largest files first
- **Directory tree** — `--tree` or `--tree-only`
- **Filtering** — `--exclude` globs, `--grep` to keep only files containing a pattern
- **Repo caching** — remote zips cached in `~/.cache/dumpall` with configurable TTL
- **Prepend a note** — `-m "fix the auth bug"` or bare `-m` for an interactive prompt

---

## Install

```bash
# Run without installing
npx dumpall src/

# Or install globally
npm install -g dumpall
```

---

## Usage

```
dumpall [sources...] [flags]
```

**Sources** can be any mix of:
- Local paths: `src/`, `README.md`, `.`
- URLs: `https://example.com`
- URL globs (sitemap-based): `"https://docs.example.com/**"`
- Repo slugs: `github.com/owner/repo`, `github.com/owner/repo@main/src/**`

---

## Flags

| Flag | Alias | Description |
|---|---|---|
| `--clip` | `-c` | Copy output to clipboard |
| `--out <file>` | `-o` | Write output to file |
| `--note [text]` | `-m` | Prepend a message/prompt (omit value for interactive) |
| `--exclude <pattern>` | `-e` | Exclude glob pattern (repeatable) |
| `--grep <pattern>` | | Only include files containing pattern (repeatable) |
| `--tree` | | Prepend directory tree to output |
| `--tree-only` | | Output only the directory tree |
| `--tokens` | | Show estimated token count |
| `--max-tokens <n>` | | Truncate output to token budget (drops largest files first) |
| `--max-file-size <size>` | | Skip files larger than size (default: 1MB) |
| `--format <fmt>` | | Output format: `md` (default), `xml`, `json` |
| `--share` | | Upload and print a shareable URL |
| `--qr` | | Upload and display a scannable QR code |
| `--stdin` | | Read sources from stdin (one per line) |
| `--follow-symlinks` | | Follow symlinks during traversal |
| `--strict` | | Abort on any error instead of skipping |
| `--no-cache` | | Bypass cache for remote fetching |
| `--cache-ttl <dur>` | | Cache TTL for branch refs (e.g. `1h`, `30m`, `0`) |
| `--max-pages <n>` | | Max pages to fetch for URL globs (default: 50) |
| `--install-completions` | | Install shell completions (bash/zsh/fish) |

---

## Environment Variables

| Variable | Description |
|---|---|
| `DUMPALL_FORMAT` | Default output format (`md`, `xml`, `json`) |
| `DUMPALL_MAX_PAGES` | Default max pages for URL glob fetching |
| `DUMPALL_CACHE_DIR` | Override cache directory (default: `~/.cache/dumpall`) |
| `GITHUB_TOKEN` | Token for private GitHub repos |
| `GITLAB_TOKEN` | Token for private GitLab repos |
| `BITBUCKET_TOKEN` | Token for private Bitbucket repos |

---

## Examples

```bash
# Dump src/ to stdout
dumpall src/

# Multiple sources — paths are CWD-relative in output
dumpall src web docs

# Copy to clipboard
dumpall src/ -c

# Write to file with a prepended note
dumpall src/ -o context.md -m "refactor the auth module"

# Interactive note prompt
dumpall src/ -m

# Directory tree only
dumpall . --tree-only

# Exclude patterns
dumpall . -e "*.test.ts" -e "dist"

# Only files containing a pattern
dumpall src/ --grep "TODO"

# Estimate tokens
dumpall src/ --tokens

# Truncate to fit a token budget
dumpall . --max-tokens 50000

# XML or JSON output
dumpall src/ --format xml

# Read from stdin
find . -name "*.ts" | dumpall --stdin

# Fetch a URL
dumpall https://example.com

# Fetch all pages matching a URL glob (via sitemap)
dumpall "https://docs.react.dev/**"

# Fetch a GitHub repo
dumpall github.com/sindresorhus/is

# Fetch a specific branch and subfolder
dumpall github.com/owner/repo@main/src/**

# Interactive fuzzy picker (current directory)
dumpall @

# Picker on a specific source, with other sources alongside
dumpall src/ @ github.com/owner/repo

# Share output as a public URL
dumpall src/ --share

# Share as QR code
dumpall src/ --qr

# Install shell completions
dumpall --install-completions
```

---

## Interactive Picker (`@`)

Append `@` to open a fuzzy file picker. Type to filter, `↑↓` to navigate, `Space` to select, `Enter` to confirm.

```bash
dumpall @                  # pick from current directory
dumpall src/ @             # pick from src/
dumpall "https://docs.example.com/**" @  # pick from sitemap URLs
dumpall github.com/owner/repo @          # pick from repo files
```

---

## Private Repos

Set the appropriate token environment variable:

```bash
GITHUB_TOKEN=ghp_xxx dumpall github.com/owner/private-repo
```

Or authenticate via the GitHub CLI (`gh auth login`) — dumpall will use it automatically as a fallback.

---

## Sharing

`--share` uploads your output and prints a URL. `--qr` shows a scannable QR code of that URL. Small files go to [paste.rs](https://paste.rs) (short URL), larger ones fall back to [litterbox.catbox.moe](https://litterbox.catbox.moe) (72h expiry, up to 1GB).

---

## License

MIT
