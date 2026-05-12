import { defineCommand, runMain } from 'citty';
import { collect, collectAsync, collectFromStdin, parseSizeArg } from './collect.js';
import type { CollectOptions, FileEntry } from './collect.js';
import { format, generateTree } from './format.js';
import type { OutputFormat } from './format.js';
import { writeOutput } from './output.js';
import { estimateTokens } from './tokens.js';
import { runPicker } from './picker.js';

const VERSION = '2.0.0';

// ---- @ operator: detect before citty parses args ----
// Returns { pickerSource, cleanedArgv } if @ is present, else { pickerSource: null, cleanedArgv }
function extractAtOperator(argv: string[]): { pickerSource: string | null; cleanedArgv: string[] } {
  const atIdx = argv.indexOf('@');
  if (atIdx === -1) return { pickerSource: null, cleanedArgv: argv };

  // The source is the arg immediately before @, if it exists and isn't a flag
  const before = atIdx > 0 ? argv[atIdx - 1] : null;
  const pickerSource = (before && !before.startsWith('-')) ? before : process.cwd();

  // Check for arg after @ that is also a source (not a flag) — error case
  const after = atIdx + 1 < argv.length ? argv[atIdx + 1] : null;
  if (after && !after.startsWith('-') && after !== '@') {
    process.stderr.write('Error: @ takes one source\n');
    process.exit(1);
  }

  // Remove the @ from argv (and the source before it if it's not a flag)
  const cleaned = argv.filter((a, i) => {
    if (i === atIdx) return false; // remove @
    if (before && !before.startsWith('-') && i === atIdx - 1) return false; // remove source
    return true;
  });

  return { pickerSource, cleanedArgv: cleaned };
}

const main = defineCommand({
  meta: {
    name: 'dumpall',
    version: VERSION,
    description: 'The universal context compiler. Everything into one document. Instantly.',
  },
  args: {
    clip: {
      type: 'boolean',
      alias: 'c',
      description: 'Copy to clipboard',
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Write to file',
    },
    note: {
      type: 'string',
      alias: 'm',
      description: 'Prepend message/prompt to output',
    },
    exclude: {
      type: 'string',
      alias: 'e',
      description: 'Exclude glob pattern (repeatable)',
    },
    grep: {
      type: 'string',
      description: 'Only files containing pattern (repeatable)',
    },
    tree: {
      type: 'boolean',
      description: 'Prepend directory tree to output',
    },
    'tree-only': {
      type: 'boolean',
      description: 'Output only directory tree',
    },
    tokens: {
      type: 'boolean',
      description: 'Show token count estimate',
    },
    'max-tokens': {
      type: 'string',
      description: 'Truncate to fit token budget (drop largest files first)',
    },
    'max-file-size': {
      type: 'string',
      description: 'Skip files larger than size (default: 1MB)',
    },
    'max-pages': {
      type: 'string',
      description: 'Max pages to fetch when using URL globs (default: 50)',
    },
    format: {
      type: 'string',
      description: 'Output format: md (default), xml, json',
    },
    stdin: {
      type: 'boolean',
      description: 'Read sources from stdin (one per line)',
    },
    'follow-symlinks': {
      type: 'boolean',
      description: 'Follow symlinks during traversal',
    },
    strict: {
      type: 'boolean',
      description: 'Abort on any error instead of skipping',
    },
    'no-cache': {
      type: 'boolean',
      description: 'Bypass cache for repo and URL fetching',
    },
  },
  run({ args }) {
    return run(args);
  },
});

// Intercept @ before citty runs
const rawArgv = process.argv.slice(2);
const { pickerSource, cleanedArgv } = extractAtOperator(rawArgv);
if (pickerSource !== null) {
  // Re-inject the cleaned argv so citty sees them
  process.argv.splice(2, rawArgv.length, ...cleanedArgv);
}

async function run(args: Record<string, unknown>) {
  // Collect positional args
  const positionals = ((args._ ?? []) as string[]).filter(Boolean);

  // Handle repeatable flags (citty passes last value; we need all values)
  // citty doesn't natively support repeatable string flags, so we parse process.argv manually
  const excludePatterns = collectRepeatable(rawArgv, ['-e', '--exclude']);
  const grepPatterns = collectRepeatable(rawArgv, ['--grep']);

  const maxFileSizeStr = args['max-file-size'] as string | undefined;
  const maxFileSize = maxFileSizeStr ? parseSizeArg(maxFileSizeStr) : 1024 * 1024;

  const maxPagesStr = args['max-pages'] as string | undefined;
  const maxPages = maxPagesStr ? parseInt(maxPagesStr, 10) : 50;

  const outputFormat = ((args.format as string | undefined) ?? 'md') as OutputFormat;
  const noCache = args['no-cache'] as boolean | undefined;

  const collectOpts: CollectOptions & { maxPages?: number; noCache?: boolean } = {
    exclude: excludePatterns,
    grep: grepPatterns,
    maxFileSize,
    followSymlinks: args['follow-symlinks'] as boolean | undefined,
    strict: args.strict as boolean | undefined,
    maxPages,
    noCache,
  };

  let sources = positionals;

  if (args.stdin) {
    const stdinSources = await collectFromStdin(collectOpts);
    sources = [...sources, ...stdinSources];
  }

  // Handle @ operator (interactive picker)
  if (pickerSource !== null) {
    const pickedEntries = await runPicker(pickerSource, collectOpts);
    // Merge with any other positional sources
    const otherEntries = sources.length > 0 ? await collectAsync(sources, collectOpts) : [];
    const entries = [...pickedEntries, ...otherEntries];
    await renderAndOutput(entries, args, outputFormat);
    return;
  }

  if (sources.length === 0 && !args.stdin) {
    process.stdout.write(getHelp());
    process.exit(0);
  }

  const entries = sources.length > 0 ? await collectAsync(sources, collectOpts) : [];

  await renderAndOutput(entries, args, outputFormat);
}

async function renderAndOutput(
  entries: FileEntry[],
  args: Record<string, unknown>,
  outputFormat: OutputFormat,
): Promise<void> {
  // max-tokens: drop largest files first
  const maxTokensStr = args['max-tokens'] as string | undefined;
  if (maxTokensStr) {
    const budget = parseInt(maxTokensStr, 10);
    applyTokenBudget(entries, budget);
  }

  const treeOnly = args['tree-only'] as boolean | undefined;
  const showTree = args.tree as boolean | undefined;

  if (treeOnly) {
    const tree = generateTree(entries);
    const out = args.format === 'json'
      ? JSON.stringify({ tree }, null, 2)
      : args.format === 'xml'
        ? `<dumpall>\n  <tree>\n${tree.split('\n').map(l => '    ' + l).join('\n')}\n  </tree>\n</dumpall>`
        : '```\n' + tree + '\n```\n';

    const note = args.note as string | undefined;
    const final = note ? `${note}\n\n---\n\n${out}` : out;

    await writeOutput(final, {
      clip: args.clip as boolean | undefined,
      outFile: args.out as string | undefined,
      showTokens: args.tokens as boolean | undefined,
    });
    return;
  }

  const tree = (showTree || treeOnly) ? generateTree(entries) : undefined;
  let output = format(entries, outputFormat, tree);

  const note = args.note as string | undefined;
  if (note) {
    output = `${note}\n\n---\n\n${output}`;
  }

  await writeOutput(output, {
    clip: args.clip as boolean | undefined,
    outFile: args.out as string | undefined,
    showTokens: args.tokens as boolean | undefined,
  });
}

function collectRepeatable(argv: string[], flags: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (flags.includes(argv[i]) && i + 1 < argv.length) {
      values.push(argv[i + 1]);
      i++;
    } else {
      for (const flag of flags) {
        if (argv[i].startsWith(flag + '=')) {
          values.push(argv[i].slice(flag.length + 1));
        }
      }
    }
  }
  return values;
}

function applyTokenBudget(entries: FileEntry[], budget: number): void {
  let total = estimateTokens(entries.map(e => e.content).join(''));
  if (total <= budget) return;

  // Sort a copy by content length desc to find which to drop
  const bySize = [...entries].sort((a, b) => b.content.length - a.content.length);
  const toRemove = new Set<string>();

  for (const e of bySize) {
    if (total <= budget) break;
    toRemove.add(e.path);
    total -= estimateTokens(e.content);
  }

  // Remove in-place
  for (let i = entries.length - 1; i >= 0; i--) {
    if (toRemove.has(entries[i].path)) {
      entries.splice(i, 1);
    }
  }
}

function getHelp(): string {
  return `dumpall v${VERSION} — The universal context compiler

USAGE
  dumpall [sources...] [flags]

SOURCES
  Local paths, URLs (http/https), repo slugs (github.com/owner/repo[@ref][/glob])

FLAGS
  -c, --clip              Copy to clipboard
  -o, --out <file>        Write to file
  -m, --note <text>       Prepend message/prompt to output
  -e, --exclude <pattern> Exclude glob pattern (repeatable)
  --grep <pattern>        Only files containing pattern (repeatable)
  --tree                  Prepend directory tree to output
  --tree-only             Output only directory tree
  --tokens                Show token count estimate
  --max-tokens <n>        Truncate to fit token budget (drop largest files first)
  --max-file-size <s>     Skip files larger than size (default: 1MB)
  --max-pages <n>         Max pages to fetch when using URL globs (default: 50)
  --format <fmt>          Output format: md (default), xml, json
  --stdin                 Read sources from stdin (one per line)
  --follow-symlinks       Follow symlinks during traversal
  --strict                Abort on any error instead of skipping
  --no-cache              Bypass cache for remote fetching
  -v, --version           Show version
  -h, --help              Show help

EXAMPLES
  dumpall src/
  dumpall . --tree --format xml
  dumpall src/ -c --tokens
  dumpall . --exclude "*.test.ts" --grep "TODO"
  find . -name "*.ts" | dumpall --stdin
  dumpall https://example.com
  dumpall "https://docs.react.dev/**"
  dumpall github.com/sindresorhus/is
  dumpall github.com/owner/repo@main/src/**
  dumpall src/ @
`;
}

runMain(main);
