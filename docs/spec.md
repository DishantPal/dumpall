# dumpall v2 — Product Specification

## Identity

**What it is:** The universal context compiler. Takes anything you point it at — files, folders, URLs, git repos — and compiles it into one structured document.

**One-liner:** "Everything into one document. Instantly."

**Philosophy:** Stupidly simple. Keyboard-native. Your hands stay on the keyboard.

**Positioning:** The `ffmpeg` of text context. Not a repo tool (that's repomix). Not an AI agent. A dumb, fast, reliable pipe that works anywhere you can type `ls`.

---

## Architecture

Every command follows the same mental model:

```
dumpall [INPUT] [FILTER] [OUTPUT]
```

- **INPUT** — what to grab (files, folders, URLs, git repos, stdin, interactive picker)
- **FILTER** — what to keep or skip (excludes, grep, tree-only, max-tokens)
- **OUTPUT** — where it goes (stdout, clipboard, file, QR)

### Special Operator

dumpall has one inline operator that doesn't need a flag:

| Operator | Meaning | Example |
|----------|---------|---------|
| `@` | Interactive fuzzy picker | `dumpall @` |

`@` is first-class syntax, not a flag. It keeps commands short and keyboard-native.

---

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js (users already have it if they use `npx`)
- **Distribution:** npm — `npx dumpall` (zero-install tryout) or `npm i -g dumpall` (permanent)
- **CLI Framework:** Citty (lightweight, TS-native)
- **Interactive UI:** `@clack/prompts` (picker, progress, text input — cohesive, modern UX)
- **Clipboard:** `clipboardy` (cross-platform, no user-installed binaries needed on macOS/Windows)
- **URL Extraction:** `@mozilla/readability` + `jsdom` + `turndown` (fetch → reader mode → markdown)
- **Shell Completions:** Custom zsh/bash/fish completion scripts (registered via `dumpall --install-completions`)
- **Glob Matching:** `picomatch` (fastest, zero-dep, supports `**`, used everywhere globs apply — local paths, URL globs, remote-repo globs)
- **License:** MIT

---

## Input Sources

All inputs can be mixed in a single command:

```bash
dumpall src/ lib/utils.ts https://docs.react.dev/hooks README.md -c
```

### Local Files & Folders

The core use case. Works anywhere on the filesystem, not just git repos.

```bash
dumpall .                          # Current directory
dumpall src/                       # Specific folder
dumpall src/index.ts lib/api.ts    # Multiple files
dumpall src/ lib/ docs/ README.md  # Mix of files and folders
```

**Smart behavior:**
- Auto-detects and skips binary files (images, compiled output, etc.)
- Respects `.dumpallignore` (gitignore syntax) for persistent excludes
- Language detection for syntax-highlighted markdown output

### Interactive Picker (`@`)

Launches a built-in fuzzy finder (powered by `@clack/prompts`). No fzf dependency required.

**One picker, one source.** `@` operates on a single source — whatever positional argument precedes it, or cwd if none. Sources cannot be mixed inside a single picker session. If you need files from two different sources, run dumpall twice or pass paths directly without `@`.

```bash
dumpall @                          # Browse current directory
dumpall src/ @                     # Browse src/
dumpall github.com/user/repo @     # Browse a remote repo
```

Passing a second source after `@` is an error:

```bash
dumpall src/ @ docs/               # ✗ Error: @ takes one source
```

**Tab completion for local paths (separate from `@`):**
Registering shell completions (`dumpall --install-completions`) enables smart tab-completion when typing paths directly — no `@` needed for local files if you know the path.

### URLs

Fetches a web page, extracts readable content via Mozilla Readability, converts to markdown via Turndown.

```bash
dumpall https://docs.react.dev/reference/react/useState -c
```

**Glob patterns on URLs:**
```bash
dumpall https://docs.react.dev/reference/react/* -c
```

How it works:
1. Check for `sitemap.xml` at domain root (and `sitemap_index.xml` for indexed sitemaps)
2. If sitemap exists → filter URLs matching the glob → fetch + convert each
3. If no sitemap → exit with a clear error. We do not fall back to crawling `<a href>` links — the noise is too high to be useful.
4. Concurrency: 5 parallel fetches at a time, with a small delay between batches. Polite-crawler default. Max page cap defaults to 50 (`--max-pages` to override).
5. Progress indicator: `↓ Fetching page 12/34...`

Most documentation sites, blogs, and content platforms publish a sitemap because SEO depends on it — so this covers the realistic use cases without the false positives a link-graph crawl produces.

### Git Repos

Detects GitHub/GitLab/Bitbucket URLs. Downloads the repo as a zip (one HTTP request), unzips to temp, processes, cleans up.

```bash
dumpall github.com/vercel/next.js -c                  # Entire repo, default branch
dumpall github.com/vercel/next.js@canary -c           # Specific branch
dumpall github.com/vercel/next.js@v14.2.0 -c          # Specific tag
dumpall github.com/vercel/next.js@a1b2c3d -c          # Specific commit SHA
dumpall github.com/vercel/next.js/src/*.ts -c          # Glob pattern on remote files
dumpall github.com/user/repo @                         # Interactive picker on remote repo
```

**Branch resolution:**
- No `@ref` → resolve the default branch via one cheap API call (`GET api.github.com/repos/OWNER/REPO`), then download that branch's zip.
- `@ref` provided → use it directly. Works for branches, tags, and full/short commit SHAs.

**Auth resolution order** (only matters when anonymous fails):
1. Try anonymous zip download — works for all public repos.
2. On 404/401, check `GITHUB_TOKEN` env var → retry with `Authorization: Bearer <token>`.
3. If no env token, check for `gh` CLI (installed + `gh auth status` returns ok) → shell out to `gh api repos/OWNER/REPO/zipball/REF -o <tmpfile>` (uses gh's stored token transparently).
4. All failed → error: `"Repo not found, or it's private. Set GITHUB_TOKEN or run 'gh auth login'."`

GitHub returns 404 for private-and-missing alike, so the error must mention both possibilities. Same pattern for GitLab (`GITLAB_TOKEN` / `glab` CLI) and Bitbucket (`BITBUCKET_TOKEN`).

**Caching:**
Downloads are cached at `~/.cache/dumpall/repos/<host>/<owner>/<repo>/<ref>.zip`.
- Branches (movable refs): cached with a **1-hour TTL**, then re-fetched.
- Tags and commit SHAs (immutable refs): cached forever.
- `--no-cache` bypasses the cache.
- `--cache-ttl <duration>` overrides the branch TTL (e.g., `--cache-ttl 24h`, `--cache-ttl 0` for always-fresh).

**Flow:**
```
$ dumpall github.com/vercel/next.js @

  ↓ Fetching vercel/next.js... 12.4 MB [=====>        ] 47%
  ↓ Fetching vercel/next.js... 12.4 MB [==============] done
  ✓ Unpacked 2,847 files

  > Pick files (type to filter, TAB to select):
    src/
    src/client/
    src/server/
    docs/
    ...
```

**Why zip, not git clone:**
- One code path, simpler implementation
- No git dependency required on user's machine
- Works for private repos with token auth
- Progress bar shows download clearly
- Temp folder cleaned up after processing

### Stdin

Accepts piped input — a list of file paths or URLs, one per line.

```bash
git diff --name-only HEAD~3 | dumpall --stdin -c     # Changed files from last 3 commits
find . -name "*.test.ts" | dumpall --stdin -c         # All test files
cat urls.txt | dumpall --stdin -c                      # List of URLs from a file
```

---

## Filters

### Exclude (`-e, --exclude`)

```bash
dumpall . -e node_modules -e .git -e "*.test.ts"
```

Supports directory names and glob patterns. Multiple `-e` flags allowed.

### `.dumpallignore`

Persistent excludes using gitignore syntax. Placed in project root:

```gitignore
# .dumpallignore
node_modules/
.git/
dist/
*.test.ts
*.spec.ts
.env*
```

Auto-discovered by walking up the directory tree from the target path.

### Grep (`--grep`)

Only include files containing a pattern:

```bash
dumpall . --grep "useState" -c      # Files containing "useState"
dumpall . --grep TODO -c            # Find all TODOs
dumpall . --grep "/api/users" -c    # Files touching this endpoint
```

Repeatable for AND semantics: `--grep useState --grep useEffect` keeps only files containing both.

### Max Tokens (`--max-tokens`)

Auto-truncate output to fit within a token budget:

```bash
dumpall . --max-tokens 50000 -c     # Fit within ~50k tokens
```

Truncation strategy: drop largest files first, or least relevant to a `--grep` pattern if provided.

### Tree Only (`--tree-only`)

Output just the directory structure, no file contents:

```bash
dumpall --tree-only . -c
```

Output:
```
src/
├── components/
│   ├── Header.tsx
│   ├── Footer.tsx
│   └── Sidebar.tsx
├── utils/
│   ├── api.ts
│   └── helpers.ts
└── index.ts
```

---

## Output

### Stdout (default)

Prints to terminal. Pipe-friendly:

```bash
dumpall . > context.md
dumpall . | wc -l
```

### Clipboard (`-c, --clip`)

Cross-platform clipboard copy. Uses `clipboardy` internally — no user-installed binaries needed on macOS/Windows. Linux may need `xclip` or `xsel`.

```bash
dumpall . -c
```

### Note / Prompt (`-m` or `--note`)

Prepend a custom message to the output — instructions for the AI, a question, context notes:

```bash
# Inline (short messages)
dumpall src/ -c -m "Refactor auth flow to use JWT instead of sessions"

# Interactive (longer messages — opens a multiline @clack/prompts text input,
# Enter inserts a newline, Shift+Enter or Ctrl+D submits)
dumpall src/ -c --note
```

Output becomes:
```
Refactor auth flow to use JWT instead of sessions

---

# File: src/auth/login.ts
...
```

This turns dumpall from "context dump" to "context + prompt in one clipboard paste."

### File Output (`-o, --out`)

Write to a file:

```bash
dumpall . -o context.md
dumpall . -o context.xml --format xml
```

### Output Formats (`--format`)

```bash
dumpall . --format md       # Markdown (default)
dumpall . --format xml      # XML (good for Claude)
dumpall . --format json     # JSON (good for programmatic use)
```

**Markdown output (default):**
```markdown
# File: src/index.ts

​```typescript
import { App } from './App';
// ...
​```

# File: src/utils/api.ts

​```typescript
export async function fetchData() {
// ...
}
​```
```

**XML output (`--format xml`):**
```xml
<dumpall>
  <file path="src/index.ts" language="typescript">
    <![CDATA[
import { App } from './App';
// ...
    ]]>
  </file>
  <file path="src/utils/api.ts" language="typescript">
    <![CDATA[
export async function fetchData() {
// ...
}
    ]]>
  </file>
</dumpall>
```

**JSON output (`--format json`):**
```json
{
  "files": [
    {
      "path": "src/index.ts",
      "language": "typescript",
      "content": "import { App } from './App';\n// ..."
    },
    {
      "path": "src/utils/api.ts",
      "language": "typescript",
      "content": "export async function fetchData() {\n// ...\n}"
    }
  ]
}
```

When `--tree` is set, an extra leading element appears: a `<tree>...</tree>` block in XML, or a `"tree": "..."` field at the top level in JSON.

**File ordering** (all formats): files appear in the order their source argument was passed. Within a single source (folder/repo), files are ordered alphabetically by path. So `dumpall src/ lib/utils.ts` always emits everything in `src/` (alphabetical) followed by `lib/utils.ts`.

### Token Count (`--tokens`)

Show estimated token count after processing:

```bash
dumpall . -c --tokens
```

```
✓ 47 files processed
✓ ~23,400 tokens
✓ Copied to clipboard
```

Uses `characters / 4` heuristic. **This is a rough estimate.** It's accurate within ~10% for English prose and typical code, but diverges significantly for non-English text, minified bundles, dense JSON, or base64. When `--max-tokens` truncates based on this estimate, the actual tokenizer count from a model may still differ — treat the limit as a target, not a guarantee.

### Tree Prefix (`--tree`)

Prepend directory structure before file contents:

```bash
dumpall . --tree -c
```

Output starts with the tree, then file contents follow. Gives the AI a structural overview before diving into code.

### QR Code (`--qr`)

Generate a QR code in the terminal for scanning from phone:

```bash
dumpall README.md --qr
```

Plain monochrome QR rendered with unicode block characters via `qrcode-terminal` — same style as the WhatsApp Web login QR that `openwa` shows. Niche but memorable. Good for quickly getting a snippet onto a mobile device for pasting into a mobile AI app.

Note: QR codes have a payload limit (~2.9 KB for max-density alphanumeric). If output exceeds that, `--qr` errors with a clear message suggesting `--tree-only` or `--max-tokens` to shrink it.

---

## Configuration

### `.dumpallignore`

Project-level persistent excludes. Gitignore-style patterns (the syntax — not the layered semantics).

**Discovery:** dumpall walks *up* from the target path looking for the nearest `.dumpallignore` and uses that single file. This matches how config-style tools (prettier, eslint) discover their configs.

**Important difference from `.gitignore`:** dumpall does **not** layer multiple ignore files from nested directories. Only the closest `.dumpallignore` on the way up applies. If you put a `.dumpallignore` inside a subfolder expecting it to add rules on top of a parent one, that won't happen — the subfolder one fully replaces the parent.

### Shell Completions

```bash
dumpall --install-completions       # Auto-detect shell, install completions
```

Supports bash, zsh, fish. Enables smart tab-completion for file paths when typing dumpall commands.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `DUMPALL_CLIP_CMD` | Override default clipboard command |
| `DUMPALL_MAX_PAGES` | Default max pages for URL glob crawling |
| `DUMPALL_FORMAT` | Default output format |
| `DUMPALL_CACHE_DIR` | Override `~/.cache/dumpall` location |
| `GITHUB_TOKEN` | Auth for private GitHub repos and higher rate limits |
| `GITLAB_TOKEN` | Auth for private GitLab repos |
| `BITBUCKET_TOKEN` | Auth for private Bitbucket repos |

### Privacy

dumpall makes **no telemetry calls, ever**. The only network traffic is what you explicitly ask for: URLs you pass, repos you reference, and (for private repos) auth requests to the relevant Git host. No analytics, no version pings, no error reporting.

---

## Complete Flag Reference

### Flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--clip` | `-c` | Copy output to clipboard |
| `--out <file>` | `-o` | Write output to file |
| `--note [text]` | `-m` | Prepend a custom message/prompt. Inline with `-m "text"` or interactive with `--note` (opens editor, Shift+Enter to confirm) |
| `--exclude <pattern>` | `-e` | Exclude by name or glob. Repeatable. |
| `--grep <pattern>` | | Only files containing pattern (long form of `~`) |
| `--tree` | | Prepend directory structure to output |
| `--tree-only` | | Output only directory structure |
| `--tokens` | | Show estimated token count |
| `--max-tokens <n>` | | Auto-truncate to fit token budget |
| `--format <fmt>` | | Output format: `md` (default), `xml`, `json` |
| `--stdin` | | Read input sources (file paths/URLs) from pipe |
| `--qr` | | Display output as QR code in terminal |
| `--max-pages <n>` | | Max pages for URL glob crawling (default 50) |
| `--max-file-size <n>` | | Skip files larger than n (default 1MB; accepts `500KB`, `2MB`) |
| `--follow-symlinks` | | Follow symlinks during traversal (default: do not follow) |
| `--strict` | | Abort on any per-source error instead of skipping |
| `--no-cache` | | Bypass the remote-repo zip cache |
| `--cache-ttl <dur>` | | TTL for branch-ref cache (default `1h`; `0` = always fresh) |
| `--install-completions` | | Install shell tab completions |
| `--version` | `-v` | Show version |
| `--help` | `-h` | Show help |

### Inline Operator (no flag needed)

| Operator | Description | Example |
|----------|-------------|---------|
| `@` | Open interactive fuzzy file picker (one source per picker) | `dumpall src/ @` |

---

## Behavior Details

### Error model

dumpall is a pipe — partial output is valuable, full failure is not. Default behavior on per-source errors:

- **Local file unreadable / permission denied:** skip, log warning to stderr, continue.
- **URL fetch failure (4xx, 5xx, timeout, DNS):** skip that URL, log warning, continue. Final summary reports how many succeeded vs failed.
- **Git repo download failure:** abort. There's no useful partial output from a half-downloaded zip.
- **Sitemap missing for URL glob:** abort with a clear error (no fallback crawl).
- **`--strict` flag:** any error aborts the run. Useful for scripted/CI use where silent skips are dangerous.

Exit codes: `0` success, `1` partial success with skips, `2` fatal error.

### Authentication

- **Private GitHub repos:** read `GITHUB_TOKEN` env var. If set, used as Bearer token for the zip download. If a private repo is requested without a token, fail with a clear "set GITHUB_TOKEN" message.
- **GitLab:** `GITLAB_TOKEN`. **Bitbucket:** `BITBUCKET_TOKEN`.
- **URL fetches:** no auth in v2. Authenticated docs/intranet pages are out of scope.

### Symlinks

By default dumpall does **not** follow symlinks during directory traversal — prevents infinite loops and accidental sprawl into system directories. Use `--follow-symlinks` to opt in. Symlinks passed *directly* as arguments are always resolved.

### File size cap

Default `--max-file-size` is **1MB**. Files exceeding it are skipped with a stderr note like `! skipping bundle.min.js (3.4MB > 1MB cap)`. Override with `--max-file-size 5MB` or `--max-file-size 0` to disable. This prevents one accidental `dist/` from blowing up output and clipboard.

### Encoding

dumpall reads files as UTF-8. UTF-16 / UTF-32 / Latin-1 files are detected (BOM sniffing + heuristic) and either decoded transparently or skipped as binary if decoding looks unsafe. No `--encoding` flag in v2 — covers the realistic cases without surface area.

---

## Competitive Positioning

### vs repomix
- repomix is repo-bound. dumpall works anywhere you can type `ls`.
- dumpall handles URLs, git repos, and local files with the same command.
- Interactive `@` picker vs config-file-driven selection.
- Glob patterns on URLs and remote repos.

### vs code2prompt
- No manual to read. `dumpall . -c` — done.
- No Rust toolchain needed.

### vs files-to-prompt
- No Python dependency. No install step.
- `npx dumpall` works instantly.

### vs manual approaches (find + cat + pbcopy)
- One command instead of piped shell scripts.
- Structured, formatted output with language detection.
- Cross-platform clipboard support.

### vs AI-native tools (Cursor, Claude Code)
- Deterministic — you know exactly what context you're sending.
- Platform-agnostic — feeds any AI, not locked to one vendor.
- Unlimited — no token caps, no daily limits.

---

## Target Users (ICPs)

### 1. The Prompt Engineer
Uses AI chat interfaces daily (Claude, ChatGPT, Gemini web). Grabs files 20-30 times/day to paste as context. Wants: one command → clipboard → paste.

### 2. The Context Switcher
Senior dev or consultant across multiple projects. Needs context from project A while working on project B. Wants: grab context from anywhere, including remote repos.

### 3. The No-Code Builder
Builds on Lovable, Bolt, Replit Agent. Has existing code/docs to feed as context. Wants: take a folder, dump it, paste into the platform's prompt box.

### 4. The Documentation Archaeologist
Consolidates scattered sources — local files, web docs, GitHub repos — into one document for specs, meetings, handoffs. Wants: point at sources, get one clean output.

---

## Brand Identity

- **Voice:** Opinionated, direct, lazy-genius energy. "Your hands stay on the keyboard."
- **Aesthetic:** Dark, terminal-native, engineering-forward. Inspired by Lumina Studio's clean typography + dark palette.
- **Vibe:** The tool built by someone who automates everything because they're too lazy to do it manually — and that laziness produces better workflows.
