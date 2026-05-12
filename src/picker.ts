import path from 'node:path';
import fs from 'node:fs';
import { isRepoUrl, fetchRepo } from './fetch-repo.js';
import { isUrlGlob, isUrl, fetchUrl, fetchUrlGlob } from './fetch-url.js';
import { collect } from './collect.js';
import type { CollectOptions, FileEntry } from './collect.js';

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const ESC = '\x1b';
const UP = (n: number) => `${ESC}[${n}A`;
const CLEAR_LINE = `${ESC}[2K\r`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const RESET = `${ESC}[0m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

// ── Fuzzy match ───────────────────────────────────────────────────────────────
function fuzzyScore(query: string, str: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = str.toLowerCase();
  let score = 0;
  let qi = 0;
  let lastMatch = -1;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      if (lastMatch === i - 1) score += 5;                      // consecutive bonus
      if (i === 0 || s[i - 1] === '/' || s[i - 1] === '.') score += 3; // segment start bonus
      score += 1;
      lastMatch = i;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

// ── Core fuzzy picker (raw TTY) ───────────────────────────────────────────────
async function fuzzyPick(files: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const out = process.stdout;
    const inp = process.stdin;

    if (!inp.isTTY || !out.isTTY) {
      resolve(files);
      return;
    }

    let query = '';
    let cursorIdx = 0;
    let scrollOffset = 0;
    const selected = new Set<string>();
    let filtered: string[] = files.slice();
    const maxVisible = Math.max(5, (out.rows ?? 24) - 6);
    let linesDrawn = 0;
    let initialized = false;

    inp.setRawMode(true);
    inp.resume();
    inp.setEncoding('utf8');
    out.write(HIDE_CURSOR);

    function applyFilter() {
      if (!query) {
        filtered = files.slice();
      } else {
        filtered = files
          .map(f => ({ f, score: fuzzyScore(query, f) }))
          .filter(x => x.score >= 0)
          .sort((a, b) => b.score - a.score)
          .map(x => x.f);
      }
      cursorIdx = 0;
      scrollOffset = 0;
    }

    function render() {
      const lines: string[] = [];

      // Input line
      lines.push(`\r${ESC}[K${BOLD}  > ${RESET}${query}`);

      // Separator
      lines.push(`\r${ESC}[K${DIM}  ${'─'.repeat(Math.max(20, (out.columns ?? 60) - 4))}${RESET}`);

      // File list
      for (let i = 0; i < maxVisible; i++) {
        const fileIdx = i + scrollOffset;
        const file = filtered[fileIdx];
        if (!file) { lines.push(`\r${ESC}[K`); continue; }
        const isCursor = fileIdx === cursorIdx;
        const isSel = selected.has(file);
        const box = isSel ? `${GREEN}◆${RESET}` : `${DIM}◇${RESET}`;
        const arrow = isCursor ? `${CYAN}❯${RESET}` : ' ';
        const label = isCursor ? `${CYAN}${BOLD}${file}${RESET}` : file;
        lines.push(`\r${ESC}[K  ${arrow} ${box} ${label}`);
      }

      // Status bar
      const scrollInfo = filtered.length > maxVisible
        ? ` ${DIM}(${scrollOffset + 1}-${Math.min(scrollOffset + maxVisible, filtered.length)}/${filtered.length})${RESET}`
        : `${DIM} ${filtered.length}/${files.length}${RESET}`;
      const selCount = selected.size > 0 ? `  ${YELLOW}${BOLD}${selected.size} selected${RESET}` : '';
      lines.push(`\r${ESC}[K${DIM}  ↑↓ nav  space select  enter confirm  esc cancel${RESET}${scrollInfo}${selCount}`);

      const totalLines = lines.length; // e.g. 20

      if (!initialized) {
        // Reserve space: scroll terminal down enough lines so picker fits
        out.write('\r\n'.repeat(totalLines));
        out.write(UP(totalLines));
        initialized = true;
      } else {
        out.write(UP(linesDrawn));
      }

      // Write all lines separated by \r\n, plus trailing \r\n so cursor lands
      // one line BELOW the picker — makes UP(totalLines) exact on next render.
      out.write(lines.join('\r\n') + '\r\n');
      linesDrawn = totalLines;
    }

    function cleanup() {
      inp.setRawMode(false);
      inp.pause();
      inp.removeAllListeners('data');
      out.write(SHOW_CURSOR);
      // Move to start of picker area and wipe all lines
      out.write(UP(linesDrawn));
      for (let i = 0; i < linesDrawn; i++) out.write(`\r${ESC}[K\r\n`);
      out.write(UP(linesDrawn));
    }

    applyFilter();
    render();

    inp.on('data', (key: string) => {
      if (key === '\x03') { cleanup(); process.exit(0); }
      if (key === '\x1b') { cleanup(); resolve([]); return; }

      if (key === '\r' || key === '\n') {
        // fzf behavior: Enter with no selections confirms the highlighted item
        if (selected.size === 0 && filtered[cursorIdx]) {
          selected.add(filtered[cursorIdx]);
        }
        cleanup();
        resolve([...selected]);
        return;
      }

      if (key === ' ') {
        const file = filtered[cursorIdx];
        if (file) selected.has(file) ? selected.delete(file) : selected.add(file);
      } else if (key === '\x1b[A') {
        cursorIdx = Math.max(0, cursorIdx - 1);
        if (cursorIdx < scrollOffset) scrollOffset = cursorIdx;
      } else if (key === '\x1b[B') {
        cursorIdx = Math.min(filtered.length - 1, cursorIdx + 1);
        if (cursorIdx >= scrollOffset + maxVisible) scrollOffset = cursorIdx - maxVisible + 1;
      } else if (key === '\x7f' || key === '\b') {
        query = query.slice(0, -1);
        applyFilter();
      } else if (key.length === 1 && key >= ' ') {
        query += key;
        applyFilter();
      }

      render();
    });
  });
}

// ── File listing (for local dirs) ─────────────────────────────────────────────
function listFilesRecursive(dir: string, base: string, results: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      listFilesRecursive(full, base, results);
    } else if (e.isFile()) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function runPicker(
  source: string,
  collectOpts: CollectOptions & { maxPages?: number; noCache?: boolean },
): Promise<FileEntry[]> {
  // ── URL glob: fetch sitemap URLs, pick from list, fetch selected ──
  if (isUrlGlob(source)) {
    const pages = await fetchUrlGlob(source, { maxPages: collectOpts.maxPages, noCache: collectOpts.noCache });
    if (pages.length === 0) { process.stderr.write('No pages found matching glob.\n'); return []; }
    const urls = pages.map(p => p.url);
    if (urls.length > 500) process.stderr.write(`  ${urls.length} pages — type to filter\n`);
    const chosen = await fuzzyPick(urls);
    if (chosen.length === 0) return [];
    const chosenSet = new Set(chosen);
    return pages
      .filter(p => chosenSet.has(p.url))
      .map(p => ({ path: p.url, relPath: p.url, content: p.content, lang: '' }));
  }

  // ── Plain URL: fetch the single page, no picker needed ──
  if (isUrl(source)) {
    process.stderr.write(`Note: @ with a single URL just fetches it — use a glob like ${source}/* to pick from multiple pages.\n`);
    const page = await fetchUrl(source);
    return [{ path: page.url, relPath: page.url, content: page.content, lang: '' }];
  }

  // ── Repo URL ──
  if (isRepoUrl(source)) {
    const repoEntries = await fetchRepo(source, collectOpts);
    const allFiles = repoEntries.map(e => e.relPath);
    if (allFiles.length === 0) { process.stderr.write('No files found in repo.\n'); return []; }
    if (allFiles.length > 500) process.stderr.write(`  ${allFiles.length} files — type to filter\n`);
    const chosen = await fuzzyPick(allFiles);
    if (chosen.length === 0) return [];
    const chosenSet = new Set(chosen);
    return repoEntries.filter(e => chosenSet.has(e.relPath));
  }

  // ── Local path ──
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`Source not found: ${source}`);
  const stat = fs.statSync(resolved);
  const allFiles = stat.isDirectory()
    ? listFilesRecursive(resolved, resolved)
    : [path.basename(resolved)];

  if (allFiles.length === 0) { process.stderr.write('No files found in source.\n'); return []; }
  if (allFiles.length > 500) process.stderr.write(`  ${allFiles.length} files — type to filter\n`);

  const chosen = await fuzzyPick(allFiles);
  if (chosen.length === 0) return [];

  const base = stat.isDirectory() ? resolved : path.dirname(resolved);
  const absPaths = chosen.map(p => path.join(base, p));
  const entries = collect(absPaths, collectOpts);
  for (const e of entries) e.relPath = path.relative(base, e.path);
  return entries;
}
