import path from 'node:path';
import fs from 'node:fs';
import { multiselect, isCancel } from '@clack/prompts';
import { isRepoUrl, fetchRepo } from './fetch-repo.js';
import { collect } from './collect.js';
import type { CollectOptions, FileEntry } from './collect.js';

function listFilesRecursive(dir: string, base: string, results: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
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

export async function runPicker(
  source: string,
  collectOpts: CollectOptions,
): Promise<FileEntry[]> {
  let allFiles: string[] = [];
  let isRepo = false;
  let repoEntries: FileEntry[] = [];

  if (isRepoUrl(source)) {
    isRepo = true;
    process.stderr.write(`↓ Downloading repo for picker...\n`);
    repoEntries = await fetchRepo(source, collectOpts);
    allFiles = repoEntries.map(e => e.relPath);
  } else {
    const resolved = path.resolve(source);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Source not found: ${source}`);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      allFiles = listFilesRecursive(resolved, resolved);
    } else {
      allFiles = [path.basename(resolved)];
    }
  }

  if (allFiles.length > 500) {
    process.stderr.write(`warn: ${allFiles.length} files found. Consider using --grep or a subfolder.\n`);
  }

  if (allFiles.length === 0) {
    process.stderr.write('No files found in source.\n');
    return [];
  }

  const selected = await multiselect({
    message: 'Pick files (space to select, enter to confirm):',
    options: allFiles.map(f => ({ value: f, label: f })),
    required: false,
  });

  if (isCancel(selected)) {
    process.stderr.write('Cancelled.\n');
    process.exit(0);
  }

  const selectedPaths = new Set(selected as string[]);

  if (isRepo) {
    return repoEntries.filter(e => selectedPaths.has(e.relPath));
  }

  // Local directory: collect just the selected files
  const resolved = path.resolve(source);
  const stat = fs.statSync(resolved);
  const base = stat.isDirectory() ? resolved : path.dirname(resolved);

  const absolutePaths = [...selectedPaths].map(p => path.join(base, p));
  const entries = collect(absolutePaths, collectOpts);
  // Re-map relPaths
  for (const e of entries) {
    e.relPath = path.relative(base, e.path);
  }
  return entries;
}
