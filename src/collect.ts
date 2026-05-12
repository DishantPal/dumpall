import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { getLang } from './lang.js';
import { isUrl, isUrlGlob, fetchUrl, fetchUrlGlob } from './fetch-url.js';
import { isRepoUrl, fetchRepo, parseDuration } from './fetch-repo.js';

export interface FileEntry {
  path: string;
  relPath: string;
  content: string;
  lang: string;
}

export interface CollectOptions {
  exclude?: string[];
  grep?: string[];
  maxFileSize?: number;
  followSymlinks?: boolean;
  strict?: boolean;
  cacheTtl?: string;
}

const ALWAYS_SKIP_DIRS = new Set(['.git', 'node_modules']);

function parseSize(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|B)?$/i);
  if (!m) throw new Error(`Invalid size: ${s}`);
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? 'B').toUpperCase();
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.floor(n * (multipliers[unit] ?? 1));
}

export function parseSizeArg(s: string): number {
  return parseSize(s);
}

function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function findDumpallIgnore(startDir: string): string[] {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, '.dumpallignore');
    if (fs.existsSync(candidate)) {
      const lines = fs.readFileSync(candidate, 'utf8').split('\n');
      return lines.map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

function makeIgnoreMatcher(patterns: string[]): ((rel: string) => boolean) | null {
  if (patterns.length === 0) return null;
  const matchers = patterns.map(p => picomatch(p, { dot: true }));
  return (rel: string) => matchers.some(m => m(rel) || m(path.basename(rel)));
}

function makeExcludeMatcher(patterns: string[]): ((rel: string, name: string) => boolean) | null {
  if (!patterns || patterns.length === 0) return null;
  const matchers = patterns.map(p => picomatch(p, { dot: true }));
  return (rel: string, name: string) =>
    matchers.some(m => m(rel) || m(name));
}

function collectFile(
  filePath: string,
  relPath: string,
  opts: CollectOptions,
  excludeMatcher: ReturnType<typeof makeExcludeMatcher>,
  ignoreMatcher: ReturnType<typeof makeIgnoreMatcher>,
  results: FileEntry[],
): void {
  const name = path.basename(filePath);
  const maxFileSize = opts.maxFileSize ?? 1024 * 1024;

  if (excludeMatcher && excludeMatcher(relPath, name)) return;
  if (ignoreMatcher && ignoreMatcher(relPath)) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    if (opts.strict) throw e;
    process.stderr.write(`warn: cannot stat ${filePath}\n`);
    return;
  }

  if (stat.size > maxFileSize) return;

  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    if (opts.strict) throw e;
    process.stderr.write(`warn: cannot read ${filePath}\n`);
    return;
  }

  if (isBinary(buf)) return;

  const content = buf.toString('utf8');

  if (opts.grep && opts.grep.length > 0) {
    if (!opts.grep.every(pattern => content.includes(pattern))) return;
  }

  results.push({ path: filePath, relPath, content, lang: getLang(name) });
}

function walkDir(
  dir: string,
  baseDir: string,
  opts: CollectOptions,
  excludeMatcher: ReturnType<typeof makeExcludeMatcher>,
  ignoreMatcher: ReturnType<typeof makeIgnoreMatcher>,
  results: FileEntry[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (opts.strict) throw e;
    process.stderr.write(`warn: cannot read dir ${dir}\n`);
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isSymbolicLink()) {
      if (!opts.followSymlinks) continue;
      // resolve and re-stat
      let real: string;
      try {
        real = fs.realpathSync(fullPath);
      } catch {
        continue;
      }
      const realStat = fs.statSync(real);
      if (realStat.isDirectory()) {
        walkDir(real, baseDir, opts, excludeMatcher, ignoreMatcher, results);
      } else {
        collectFile(real, relPath, opts, excludeMatcher, ignoreMatcher, results);
      }
      continue;
    }

    if (entry.isDirectory()) {
      if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
      if (excludeMatcher && excludeMatcher(relPath, entry.name)) continue;
      if (ignoreMatcher && ignoreMatcher(relPath)) continue;
      walkDir(fullPath, baseDir, opts, excludeMatcher, ignoreMatcher, results);
    } else if (entry.isFile()) {
      collectFile(fullPath, relPath, opts, excludeMatcher, ignoreMatcher, results);
    }
  }
}

export function collect(sources: string[], opts: CollectOptions): FileEntry[] {
  const results: FileEntry[] = [];
  const excludeMatcher = makeExcludeMatcher(opts.exclude ?? []);

  for (const src of sources) {
    // URL and repo sources are handled asynchronously via collectAsync
    if (isUrl(src) || isRepoUrl(src)) continue;

    let resolved: string;
    try {
      resolved = fs.realpathSync(path.resolve(src));
    } catch {
      resolved = path.resolve(src);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch (e) {
      if (opts.strict) throw e;
      process.stderr.write(`warn: cannot access ${src}\n`);
      continue;
    }

    const ignorePatterns = findDumpallIgnore(
      stat.isDirectory() ? resolved : path.dirname(resolved),
    );
    const ignoreMatcher = makeIgnoreMatcher(ignorePatterns);

    if (stat.isDirectory()) {
      walkDir(resolved, resolved, opts, excludeMatcher, ignoreMatcher, results);
    } else {
      const relPath = path.basename(resolved);
      collectFile(resolved, relPath, opts, excludeMatcher, ignoreMatcher, results);
    }
  }

  return results;
}

export async function collectAsync(
  sources: string[],
  opts: CollectOptions & { maxPages?: number; noCache?: boolean },
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];

  // First collect local files synchronously
  const localSources = sources.filter(s => !isUrl(s) && !isRepoUrl(s));
  results.push(...collect(localSources, opts));

  // Then handle remote sources — repo check must come before URL check so that
  // https://github.com/... is treated as a repo, not fetched as a web page.
  for (const src of sources) {
    if (isRepoUrl(src)) {
      try {
        const ttlMs = opts.cacheTtl ? parseDuration(opts.cacheTtl) : undefined;
        const entries = await fetchRepo(src, opts, opts.noCache, ttlMs);
        results.push(...entries);
      } catch (e) {
        if (opts.strict) throw e;
        process.stderr.write(`warn: failed to fetch repo ${src}: ${(e as Error).message}\n`);
      }
    } else if (isUrlGlob(src)) {
      const pages = await fetchUrlGlob(src, { maxPages: opts.maxPages, noCache: opts.noCache });
      for (const page of pages) {
        results.push({ path: page.url, relPath: page.url, content: page.content, lang: '' });
      }
    } else if (isUrl(src)) {
      try {
        const page = await fetchUrl(src);
        results.push({ path: page.url, relPath: page.url, content: page.content, lang: '' });
      } catch (e) {
        if (opts.strict) throw e;
        process.stderr.write(`warn: failed to fetch ${src}: ${(e as Error).message}\n`);
      }
    }
  }

  return results;
}

export async function collectFromStdin(opts: CollectOptions): Promise<string[]> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      const lines = data.split('\n').map(l => l.trim()).filter(Boolean);
      resolve(lines);
    });
  });
}
