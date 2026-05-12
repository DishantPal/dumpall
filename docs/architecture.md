## Overview

This is the implementation plan for dumpall v2 — a TypeScript rewrite of the v1 bash script. Read `spec.md` first for the product surface; this doc only covers *how* we build it.

**Out of scope for this doc:** website, marketing, npm publishing process, CI. CLI only.

---

## Repo layout

Single package, no monorepo. The existing repo already contains the website (`index.html`, `why.html`) and the v1 bash script (`dumpall`). v2 adds a `src/` tree alongside.

```
dumpall/
├── src/                      # NEW — TypeScript source
│   ├── cli.ts                # entry: parse args, dispatch
│   ├── pipeline.ts           # the INPUT → FILTER → OUTPUT orchestrator
│   ├── inputs/               # one module per input source
│   │   ├── local.ts
│   │   ├── url.ts
│   │   ├── git.ts
│   │   ├── stdin.ts
│   │   └── picker.ts         # @ operator
│   ├── filters/
│   │   ├── ignore.ts         # .dumpallignore + --exclude
│   │   ├── grep.ts           # --grep
│   │   ├── tree.ts           # --tree-only / --tree
│   │   └── budget.ts         # --max-tokens truncation
│   ├── outputs/
│   │   ├── markdown.ts
│   │   ├── xml.ts
│   │   ├── json.ts
│   │   ├── clipboard.ts
│   │   ├── qr.ts
│   │   └── stdout.ts
│   ├── util/
│   │   ├── binary.ts         # text/binary detection
│   │   ├── encoding.ts       # UTF-8/16 BOM sniffing
│   │   ├── language.ts       # extension → markdown lang tag
│   │   ├── tokens.ts         # chars/4 estimate
│   │   ├── glob.ts           # picomatch wrapper
│   │   ├── cache.ts          # ~/.cache/dumpall/ helpers
│   │   ├── auth.ts           # GITHUB_TOKEN / gh CLI resolution
│   │   ├── logger.ts         # stderr warnings, --strict
│   │   └── fs.ts             # walker, file size cap, symlinks
│   └── completions/
│       ├── bash.ts
│       ├── zsh.ts
│       └── fish.ts
├── bin/
│   └── dumpall.js            # 2-line shebang wrapper requiring dist/cli.js
├── dist/                     # build output (gitignored)
├── docs/                     # spec.md, design.md
├── test/                     # vitest tests, mirrors src/ layout
├── dumpall                   # v1 bash (delete on v2 release)
├── web/                      # website (index.html, why.html, logo.png, demo.gif) — untouched by v2 work
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

**Migration of `bin`:** `package.json` currently points `bin.dumpall` at the bash file. v2 publish flips it to `bin/dumpall.js`. Keep the bash file in the repo until v2 ships, then delete in the same commit that bumps to `2.0.0`.

---

## Tech choices

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, strict mode | Type safety with zero runtime cost |
| Runtime | Node >= 18 | Native `fetch`, native `node:test` if needed, `Readable.fromWeb` |
| CLI parser | `citty` | TS-native, tiny, supports subcommand-free root command |
| Prompts/UI | `@clack/prompts` | Fuzzy-ish picker (we'll wrap `multiselect` + filter), spinner, multiline text |
| Globs | `picomatch` | Fastest, zero deps, supports `**` |
| HTML→MD | `@mozilla/readability` + `jsdom` + `turndown` | Standard combo, server-rendered pages |
| Sitemaps | `fast-xml-parser` | Tiny, no schema fuss |
| Zip | `unzipper` (streaming) | Don't load whole zip in memory for large repos |
| Clipboard | `clipboardy` | Cross-platform, bundled binaries |
| QR | `qrcode-terminal` | Plain monochrome, exactly what we want |
| Token estimate | hand-rolled `chars/4` | No tokenizer dependency |
| Bundler | `tsup` | Zero-config, single ESM bundle output |
| Tests | `vitest` | Fast, TS-native, decent ESM story |

Avoided: `commander`, `yargs`, `inquirer` (heavier), `simple-git` (we don't clone), `fs-extra` (not needed in modern Node).

**Build:** `tsup src/cli.ts --format esm --target node18 --clean`. Output `dist/cli.js`. Bundled — no `node_modules` traversal at runtime, faster startup, smaller npm tarball.

**Startup target:** `dumpall --help` cold should return in <100ms. Lazy-import heavy deps (`jsdom`, `turndown`, `unzipper`) only when their input source is invoked.

---

## Data model

One type flows through the whole pipeline:

```ts
type DumpFile = {
  path: string;          // display path, e.g. "src/index.ts" or "https://docs.x/foo"
  source: SourceTag;     // which input produced it (for ordering, errors)
  language: string;      // ts, py, md, "" if unknown
  content: string;       // already decoded to string
  bytes: number;         // original byte size (for budget calc)
};

type SourceTag = {
  kind: 'local' | 'url' | 'git' | 'stdin' | 'picker';
  origin: string;        // 'src/', 'github.com/x/y@main', 'https://docs.x/*', ...
  index: number;         // position in argv, used for output ordering
};
```

Inputs produce `AsyncIterable<DumpFile>`. Filters transform `AsyncIterable<DumpFile> → AsyncIterable<DumpFile>`. Outputs consume the iterable.

Streaming matters for two reasons: (1) progress UX (we can show "12/34 fetched" while still working), (2) large repos shouldn't blow memory.

---

## Pipeline

```
argv
  → parse (citty)
  → resolve sources [InputModule[]]
  → merge into one AsyncIterable<DumpFile>   (preserving arg order)
  → apply filters (ignore → grep → budget → tree)
  → render (markdown / xml / json)
  → write (stdout / clipboard / file / qr)
```

**Ordering rule:** files come out in the order their source argument was passed; within a source, alphabetical by path. Implementation: each source emits its own iterable; we don't `Promise.all` them — we drain them in argv order. URL/git fetching may happen concurrently in the *background* (warm the cache, prefetch), but emission stays sequential.

**Per-source errors:** wrapped in a `try` per source. On error: log to stderr via `logger.warn`, set process exit code to `1`, continue. With `--strict`: rethrow, exit code `2`.

---

## Input modules

Each input module exports:

```ts
export interface InputModule {
  match(arg: string): boolean;             // does this arg belong to this module?
  resolve(args: string[], opts: Opts):     // turn matching args into files
    AsyncIterable<DumpFile>;
}
```

Dispatch in `cli.ts` is dumb: for each positional, find the first matching module.

### local.ts
- `fs.opendir` based walker, async generator.
- Symlinks: stat with `lstat`, skip unless `--follow-symlinks`. Track inode set to break cycles even when following.
- File size cap: stat-check, skip with stderr warning.
- Binary detection: read first 8KB, check for null byte → binary.
- Encoding: BOM sniff for UTF-16 LE/BE, decode via `TextDecoder`. No BOM + null bytes in the 8KB sample → treat as binary.
- Ignore behavior is delegated to `filters/ignore.ts` (see below) — the walker just emits everything; ignore matching happens as a filter stage. This keeps the walker pure and makes ignore rules testable in isolation.

### url.ts
- Single URL: `fetch` → `jsdom` → `Readability.parse` → `turndown`.
- Globbed URL (contains `*`): fetch `<origin>/sitemap.xml`, fall back to `sitemap_index.xml`. Filter URLs through picomatch against the user's pattern. Apply `--max-pages` cap. Fetch concurrency 5 with 100ms inter-batch delay. No HTML link-graph fallback.
- Per-URL failures (4xx/5xx/timeout): skip-and-warn (or abort under `--strict`).

### git.ts
- Parse `host/owner/repo[@ref][/glob...]` into `{host, owner, repo, ref, pathGlob}`.
- If `ref` missing: `GET https://api.github.com/repos/{owner}/{repo}` → use `default_branch`.
- Cache lookup: `~/.cache/dumpall/repos/<host>/<owner>/<repo>/<ref>.zip`. Branches honor `--cache-ttl` (default 1h). Tags/SHAs cached forever (immutable).
- Auth resolution (only if anonymous returns 404/401):
  1. `GITHUB_TOKEN` env → retry with `Authorization: Bearer ...`.
  2. `gh` CLI fallback. Best-effort, platform-agnostic detection: `which gh` / `where gh` (2s timeout) then `gh auth status` (2s timeout, exit code 0 = ok). The whole probe is wrapped in try/catch — *any* failure (not found, timeout, throws) silently falls through to the error case. No Windows-specific branching; the timeout + catch handles flaky `PATH` resolution uniformly. On success: `child_process.execFile('gh', ['api', 'repos/OWNER/REPO/zipball/REF'], { stdio: ['ignore', fileWriteStream, 'pipe'] })` streams the zip directly to the cache file.
  3. Otherwise error: `"Repo not found, or it's private. Set GITHUB_TOKEN or run 'gh auth login'."`
- Stream-unzip via `unzipper.Parse()` directly into `DumpFile` emission — no intermediate disk extraction. Apply `pathGlob` (if provided) before emitting.

### stdin.ts
- Read lines from `process.stdin`. Skip blank lines and lines starting with `#`.
- Each line: re-dispatch through the input matcher (so a stdin list can mix paths and URLs).

### picker.ts
- `@` is detected during arg parse, paired with the *previous* positional (or cwd if none).
- That source's iterable is fully drained into a list, presented via `@clack/prompts.multiselect` wrapped with a typed-filter overlay.
- **Visible window: 50 items** at a time, with a "type to narrow" hint shown at the bottom. Filtering happens locally as the user types — no pagination needed because typing narrows the list quickly. For repos with thousands of files this keeps initial render fast.
- One picker per invocation. Mixing `@` with a second source after it is a parse-time error.

---

## Filters

All filters are async-iterable transforms. Pure functions of `(in, opts) → out`.

- **ignore.ts** — layered ignore resolution:
  1. **Hardcoded minimum, always applied:** `.git/`, `node_modules/`, lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`). Skipped even if no user ignore file lists them — this is the "I forgot to ignore node_modules" footgun guard.
  2. **Project ignore file**, walking up from each source's root, in priority order:
     - `.dumpallignore` → use it, stop searching.
     - else `.gitignore` → use it as a sensible fallback. New users get reasonable defaults from their existing git setup; power users opt into `.dumpallignore` when they want different rules.
     - else nothing extra.
  3. **`--exclude` flags from argv** are appended on top.
  Compile the final union into a single picomatch matcher.
- **grep.ts** — for each file, scan content for *all* `--grep` patterns (AND semantics). Memory-efficient: `String.prototype.includes` per pattern. Drop the file's content from the stream if it doesn't match (skip emission entirely — don't buffer).
- **tree.ts** — collect paths into an in-memory tree, render with box-drawing. With multiple sources, emit **one tree per source**, each labeled with its origin (e.g., `# Tree: src/`, `# Tree: github.com/vercel/next.js@canary`), in argv order, before that source's file content. With `--tree-only`, only the trees are emitted (no file content). With `--tree`, trees prepend their respective sources.
- **budget.ts** — `--max-tokens`. Buffer all files, sort by size desc, drop largest until under budget. (Yes, this defeats streaming — accept it; budget mode is opt-in.)

---

## Outputs

`render(stream, format) → string | AsyncIterable<string>`

- **markdown.ts** — emit `# File: <path>\n\n\`\`\`<lang>\n<content>\n\`\`\`\n\n` per file.
- **xml.ts** — emit `<dumpall>` open, per-file `<file path lang>...<![CDATA[...]]>...</file>`, close. Stream the open/close brackets, not buffer-then-serialize.
- **json.ts** — for streaming we'd need ndjson; v2 just buffers and `JSON.stringify`s the whole `{ files: [...] }`. Acceptable: JSON output is rarely huge in practice.

Then a writer:
- `stdout.ts` — `process.stdout.write` chunks.
- `clipboard.ts` — buffer to string, `clipboardy.write(s)`.
- `out` (`-o file`) — pipe to write stream.
- `qr.ts` — buffer, check size <2900 bytes, render via `qrcode-terminal`.

`-c` and `-o` and `--qr` are mutually exclusive at parse time. Default writer is stdout.

---

## CLI parsing details

`citty` definition: one root command with all flags, all positionals captured. After parse:

1. Walk positionals to detect `@` operator and pair it with the preceding positional.
2. Validate flag combinations (mutex on output sinks, `--max-tokens` requires non-streaming budget).
3. Build `Opts` record passed everywhere downstream.

Help output: hand-written for layout (citty's default is fine, but we want the example block to look clean). Version: read from `package.json` via JSON import.

Shell completion install (`--install-completions`): detect shell via `$SHELL`, write the appropriate script to the right location (`~/.zsh/completions/_dumpall`, `~/.local/share/bash-completion/completions/dumpall`, `~/.config/fish/completions/dumpall.fish`), print one line telling the user to reload.

---

## Caching layout

```
~/.cache/dumpall/
└── repos/
    └── github.com/
        └── vercel/
            └── next.js/
                ├── canary.zip            # branch (TTL-checked)
                ├── canary.zip.meta       # JSON: { fetchedAt, etag }
                ├── v14.2.0.zip           # tag (forever)
                └── a1b2c3d.zip           # SHA (forever)
```

Meta file holds `fetchedAt` for TTL and `etag` for conditional GETs (use `If-None-Match` header → 304 means cache stays valid, no full re-download even if TTL expired).

Override root via `DUMPALL_CACHE_DIR`. `--no-cache` skips read+write entirely. Cleanup is manual (`rm -rf ~/.cache/dumpall`) for v2; auto-eviction can come later.

---

## Error handling & exit codes

| Exit | Meaning |
|---|---|
| 0 | All sources succeeded |
| 1 | At least one per-source error was skipped (URL fetch failed, file unreadable, etc.) |
| 2 | Fatal — bad args, no inputs, sitemap missing for URL glob, all auth failed, `--strict` triggered |

Logger: `logger.warn(msg)` writes `! ${msg}\n` to stderr in dim red. `logger.error(msg)` writes `✗ ${msg}\n` and sets exit code 2.

---

## Testing strategy

- **Unit:** every filter and util is a pure function — easy. Walker tested against a fixture tree under `test/fixtures/`. Picomatch wrapper tested for the patterns the spec advertises.
- **Integration:** spawn the built CLI as a subprocess (`execa`), feed it real fixture inputs, snapshot stdout. One integration test per documented example in `spec.md` — keeps the spec honest.
- **Mocking:** `fetch` mocked via `msw` for URL/git tests. No real network in CI.
- **Cross-platform:** GitHub Actions matrix on Linux/macOS/Windows. Clipboard tests skipped on Linux CI (no display).

---

## Build phases (Claude Code, single session)

We're building this end-to-end in one go. The phases below are gates, not shippable releases — each one has to compile and the prior phase's smoke test still pass before moving on. The order is chosen to surface the biggest unknowns first (so we're not 80% done when something fundamental breaks) and to put end-to-end execution working as early as possible.

**Phase 1 — Skeleton & contracts.**
- `package.json` (deps, scripts, `bin` pointing at `bin/dumpall.js`), `tsconfig.json` (strict, ESM, NodeNext), `tsup.config.ts`, `vitest.config.ts`, `.gitignore` for `dist/`.
- `bin/dumpall.js` shebang wrapper.
- `src/types.ts` — `DumpFile`, `SourceTag`, `Opts`, `InputModule`.
- `src/cli.ts` — citty parse, validate flag mutex, build `Opts`, hand off to pipeline.
- `src/pipeline.ts` — empty orchestrator that wires inputs → filters → render → write.
- All input/filter/output modules created as **stubs** (just exports + signatures, no logic).
- Smoke gate: `node bin/dumpall.js --help` shows help, `--version` prints from package.json.

**Phase 2 — Local files end-to-end (the vertical slice).**
- `util/fs.ts` walker with symlink + size-cap handling.
- `util/binary.ts`, `util/encoding.ts`, `util/language.ts`.
- `inputs/local.ts`.
- `filters/ignore.ts` with the full layered logic (hardcoded minimum + `.dumpallignore` → `.gitignore` fallback + `--exclude`).
- `outputs/markdown.ts` + `outputs/stdout.ts`.
- Smoke gate: `node bin/dumpall.js src/` outputs valid markdown for the project itself.

**Phase 3 — All filters and writers.**
- `filters/grep.ts`, `filters/tree.ts` (with one-tree-per-source), `filters/budget.ts`.
- `outputs/xml.ts`, `outputs/json.ts`.
- `outputs/clipboard.ts` (`-c`), `out` writer (`-o`), `outputs/qr.ts` (`--qr`).
- `util/tokens.ts`.
- Smoke gate: every flag from the spec's flag table runs end-to-end against local files.

**Phase 4 — Stdin and URLs.**
- `inputs/stdin.ts` (re-dispatching through input matchers).
- `inputs/url.ts` — single URL via readability + turndown, sitemap glob via fast-xml-parser.
- Concurrency-5 fetch helper with per-batch delay.
- Smoke gate: `dumpall https://example.com -c` produces markdown; sitemap glob test against a real docs site.

**Phase 5 — Git repos.**
- `util/cache.ts`, `util/auth.ts` (env token + `gh` CLI probe with timeouts).
- `inputs/git.ts` — parse, default-branch resolve, zip stream-unzip via `unzipper`, glob filter.
- Smoke gate: `dumpall github.com/sindresorhus/slugify` works anonymously; cached zip on second run.

**Phase 6 — Picker and `--note`.**
- `inputs/picker.ts` — clack multiselect with 50-item visible window + type-to-narrow.
- `--note` interactive multiline input.
- Smoke gate: `dumpall src/ @` opens picker, selections render correctly.

**Phase 7 — Polish.**
- `--strict` semantics threaded through error paths.
- `completions/{bash,zsh,fish}.ts` + `--install-completions`.
- All `DUMPALL_*` env var overrides honored.
- Logger formatting (dim red `!` warnings, `✗` errors).
- Smoke gate: full spec walkthrough — every documented example runs cleanly.

**Phase 8 — Tests.**
- Unit tests for every util and filter.
- Integration tests: subprocess-spawn the built CLI for each documented example in `spec.md`, snapshot stdout. This catches spec/code drift on every future change.
- `msw` mocks for URL and git host requests.
- Smoke gate: `pnpm test` green.

Every phase ends with a manual run against this very repo (`node bin/dumpall.js .`) as a sanity check. If the output looks wrong, fix it before moving on — don't compound errors across phases.
