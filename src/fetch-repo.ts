import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import unzipper from 'unzipper';
import picomatch from 'picomatch';
import { collect } from './collect.js';
import type { CollectOptions, FileEntry } from './collect.js';
import { spinner } from './progress.js';

const USER_AGENT = 'dumpall/2.0 (+https://dumpall.pages.dev)';

export interface RepoParsed {
  host: 'github.com' | 'gitlab.com' | 'bitbucket.org';
  owner: string;
  repo: string;
  ref: string | null;
  pathGlob: string | null;
}

const REPO_PATTERN = /^(github\.com|gitlab\.com|bitbucket\.org)\/([^/\s@]+)\/([^/\s@]+)(?:@([^\s/]+))?(\/.*)?$/;

export function isRepoUrl(arg: string): boolean {
  return REPO_PATTERN.test(arg);
}

export function parseRepoUrl(arg: string): RepoParsed {
  const m = arg.match(REPO_PATTERN);
  if (!m) throw new Error(`Not a repo URL: ${arg}`);

  const host = m[1] as RepoParsed['host'];
  const owner = m[2];
  const repo = m[3];
  const ref = m[4] ?? null;
  const rest = m[5] ? m[5].slice(1) : null; // remove leading /

  return { host, owner, repo, ref, pathGlob: rest };
}

async function fetchWithAuth(
  url: string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { headers });
}

async function resolveDefaultBranch(parsed: RepoParsed): Promise<string> {
  const { host, owner, repo } = parsed;
  let apiUrl: string;

  if (host === 'github.com') {
    apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  } else if (host === 'gitlab.com') {
    apiUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}`;
  } else {
    apiUrl = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`;
  }

  const token = getToken(host);
  let res = await fetchWithAuth(apiUrl, token);

  if ((res.status === 401 || res.status === 404) && !token) {
    throw new Error(
      `Repo not found or private. Set GITHUB_TOKEN (or GITLAB_TOKEN/BITBUCKET_TOKEN) or run 'gh auth login'.`,
    );
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} resolving default branch for ${owner}/${repo}`);
  }

  const data = await res.json() as Record<string, unknown>;

  if (host === 'github.com') return (data.default_branch as string) ?? 'main';
  if (host === 'gitlab.com') return (data.default_branch as string) ?? 'main';
  // Bitbucket
  const mainbranch = data.mainbranch as { name?: string } | undefined;
  return mainbranch?.name ?? 'main';
}

function getToken(host: string): string | undefined {
  if (host === 'github.com') return process.env['GITHUB_TOKEN'];
  if (host === 'gitlab.com') return process.env['GITLAB_TOKEN'];
  if (host === 'bitbucket.org') return process.env['BITBUCKET_TOKEN'];
  return undefined;
}

function getZipUrl(parsed: RepoParsed, ref: string): string {
  const { host, owner, repo } = parsed;
  if (host === 'github.com') {
    return `https://github.com/${owner}/${repo}/archive/${ref}.zip`;
  }
  if (host === 'gitlab.com') {
    return `https://gitlab.com/${owner}/${repo}/-/archive/${ref}/${repo}-${ref}.zip`;
  }
  // Bitbucket
  return `https://bitbucket.org/${owner}/${repo}/get/${ref}.zip`;
}

function getCachePath(parsed: RepoParsed, ref: string): string {
  const cacheDir = path.join(os.homedir(), '.cache', 'dumpall', 'repos', parsed.host, parsed.owner, parsed.repo);
  fs.mkdirSync(cacheDir, { recursive: true });
  return path.join(cacheDir, `${ref}.zip`);
}

function isCacheValid(cachePath: string, isImmutable: boolean): boolean {
  try {
    const stat = fs.statSync(cachePath);
    if (isImmutable) return true;
    // Branch: 1-hour TTL
    const ONE_HOUR = 60 * 60 * 1000;
    return Date.now() - stat.mtimeMs < ONE_HOUR;
  } catch {
    return false;
  }
}

function isImmutableRef(ref: string): boolean {
  // Tags: typically like v1.2.3, 1.2.3
  // Full SHA: 40 hex chars, or short SHA >= 7 hex chars
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return true;
  if (/^v?\d+\.\d+/.test(ref)) return true;
  return false;
}

async function downloadZip(url: string, destPath: string, host: string): Promise<void> {
  const token = getToken(host);
  let res = await fetchWithAuth(url, token);

  if ((res.status === 401 || res.status === 404) && !token) {
    throw new Error(
      `Repo not found or private. Set GITHUB_TOKEN (or GITLAB_TOKEN/BITBUCKET_TOKEN) or run 'gh auth login'.`,
    );
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

function makeTempDir(): string {
  const tmp = path.join(os.tmpdir(), `dumpall-repo-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

export async function fetchRepo(
  arg: string,
  collectOpts: CollectOptions,
  noCache = false,
): Promise<FileEntry[]> {
  const parsed = parseRepoUrl(arg);

  const sp = spinner(`Fetching ${parsed.owner}/${parsed.repo}...`);

  const ref = parsed.ref ?? await resolveDefaultBranch(parsed);
  const zipUrl = getZipUrl(parsed, ref);
  const cachePath = getCachePath(parsed, ref);
  const immutable = isImmutableRef(ref);

  const needDownload = noCache || !isCacheValid(cachePath, immutable);

  if (needDownload) {
    sp.update(`Downloading ${parsed.owner}/${parsed.repo}@${ref}...`);
    await downloadZip(zipUrl, cachePath, parsed.host);
    sp.update(`Extracting ${parsed.owner}/${parsed.repo}...`);
  } else {
    sp.update(`Extracting ${parsed.owner}/${parsed.repo} (cached)...`);
  }

  const tmpDir = makeTempDir();

  try {
    await extractZip(cachePath, tmpDir);

    const extracted = fs.readdirSync(tmpDir);
    const repoRoot = extracted.length === 1 && fs.statSync(path.join(tmpDir, extracted[0])).isDirectory()
      ? path.join(tmpDir, extracted[0])
      : tmpDir;

    const entries = collect([repoRoot], collectOpts);

    for (const e of entries) {
      e.relPath = path.relative(repoRoot, e.path);
    }

    if (parsed.pathGlob) {
      const isMatch = picomatch(parsed.pathGlob, { dot: true });
      const filtered = entries.filter(e => isMatch(e.relPath) || e.relPath.startsWith(parsed.pathGlob!.replace(/\*/g, '')));
      sp.done(`${filtered.length} files from ${parsed.owner}/${parsed.repo}`);
      return filtered;
    }

    sp.done(`${entries.length} files from ${parsed.owner}/${parsed.repo}`);
    return entries;
  } finally {
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
