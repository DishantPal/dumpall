import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ZSH_COMPLETION_FUNCTION = `#compdef dumpall
_dumpall() {
  _arguments \\
    '-c[Copy to clipboard]' \\
    '--clip[Copy to clipboard]' \\
    '-o[Write to file]:file:_files' \\
    '--out[Write to file]:file:_files' \\
    '-m[Prepend note]:message:' \\
    '--note[Prepend note]:message:' \\
    '-e[Exclude pattern]:pattern:' \\
    '--exclude[Exclude pattern]:pattern:' \\
    '--grep[Filter by pattern]:pattern:' \\
    '--tree[Prepend directory tree]' \\
    '--tree-only[Output only directory tree]' \\
    '--tokens[Show token count]' \\
    '--max-tokens[Token budget]:n:' \\
    '--max-file-size[Max file size]:size:' \\
    '--format[Output format]:fmt:(md xml json)' \\
    '--stdin[Read sources from stdin]' \\
    '--qr[Display as QR code]' \\
    '--max-pages[Max pages for URL glob]:n:' \\
    '--follow-symlinks[Follow symlinks]' \\
    '--strict[Abort on error]' \\
    '--no-cache[Bypass cache]' \\
    '--cache-ttl[Cache TTL]:duration:' \\
    '--install-completions[Install shell completions]' \\
    '--version[Show version]' \\
    '--help[Show help]' \\
    '*:source:_files'
}
_dumpall
`;

const BASH_COMPLETION = `
# dumpall completions
_dumpall_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local flags="--clip --out --note --exclude --grep --tree --tree-only --tokens --max-tokens --format --stdin --qr --max-pages --max-file-size --follow-symlinks --strict --no-cache --cache-ttl --install-completions --version --help"
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "$flags" -- "$cur"))
  else
    COMPREPLY=($(compgen -f -- "$cur"))
  fi
}
complete -F _dumpall_complete dumpall
`;

const FISH_COMPLETION = `complete -c dumpall -s c -l clip -d 'Copy to clipboard'
complete -c dumpall -s o -l out -d 'Write to file' -r
complete -c dumpall -s m -l note -d 'Prepend note' -r
complete -c dumpall -s e -l exclude -d 'Exclude pattern' -r
complete -c dumpall -l grep -d 'Filter by pattern' -r
complete -c dumpall -l tree -d 'Prepend directory tree'
complete -c dumpall -l tree-only -d 'Output directory tree only'
complete -c dumpall -l tokens -d 'Show token count'
complete -c dumpall -l max-tokens -d 'Token budget' -r
complete -c dumpall -l max-file-size -d 'Max file size' -r
complete -c dumpall -l format -d 'Output format' -r -a 'md xml json'
complete -c dumpall -l stdin -d 'Read sources from stdin'
complete -c dumpall -l qr -d 'Display as QR code'
complete -c dumpall -l max-pages -d 'Max pages for URL glob' -r
complete -c dumpall -l follow-symlinks -d 'Follow symlinks'
complete -c dumpall -l strict -d 'Abort on error'
complete -c dumpall -l no-cache -d 'Bypass cache'
complete -c dumpall -l cache-ttl -d 'Cache TTL' -r
complete -c dumpall -l install-completions -d 'Install shell completions'
complete -c dumpall -s v -l version -d 'Show version'
complete -c dumpall -s h -l help -d 'Show help'
`;

function fileContains(filePath: string, str: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(str);
  } catch {
    return false;
  }
}

function appendToFile(filePath: string, content: string): void {
  fs.appendFileSync(filePath, content, 'utf8');
}

export async function installCompletions(): Promise<void> {
  const shell = process.env['SHELL'] ?? '';
  const shellName = path.basename(shell);

  if (shellName === 'zsh' || shell.includes('zsh')) {
    const completionsDir = path.join(os.homedir(), '.zsh', 'completions');
    fs.mkdirSync(completionsDir, { recursive: true });

    const completionFile = path.join(completionsDir, '_dumpall');
    fs.writeFileSync(completionFile, ZSH_COMPLETION_FUNCTION, 'utf8');

    const zshrc = path.join(os.homedir(), '.zshrc');
    const fpathLine = 'fpath=(~/.zsh/completions $fpath)';
    if (!fileContains(zshrc, fpathLine)) {
      appendToFile(zshrc, `\n# dumpall completions\n${fpathLine}\nautoload -Uz compinit && compinit\n`);
    }

    process.stdout.write('✓ Installed completions for zsh\n');
    process.stdout.write('  Restart your shell or run: source ~/.zshrc\n');
  } else if (shellName === 'fish' || shell.includes('fish')) {
    const fishCompletionsDir = path.join(os.homedir(), '.config', 'fish', 'completions');
    fs.mkdirSync(fishCompletionsDir, { recursive: true });

    const completionFile = path.join(fishCompletionsDir, 'dumpall.fish');
    fs.writeFileSync(completionFile, FISH_COMPLETION, 'utf8');

    process.stdout.write('✓ Installed completions for fish\n');
    process.stdout.write(`  Written to ${completionFile}\n`);
  } else if (shellName === 'bash' || shell.includes('bash')) {
    const bashrc = path.join(os.homedir(), '.bashrc');
    if (!fileContains(bashrc, '_dumpall_complete')) {
      appendToFile(bashrc, BASH_COMPLETION);
    }

    process.stdout.write('✓ Installed completions for bash\n');
    process.stdout.write('  Restart your shell or run: source ~/.bashrc\n');
  } else {
    process.stderr.write(`warn: Unknown shell: ${shell || '(not set)'}. Supported: bash, zsh, fish\n`);
    process.exit(1);
  }
}
