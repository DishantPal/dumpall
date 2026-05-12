const map: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  sql: 'sql',
  md: 'markdown',
  mdx: 'mdx',
  json: 'json',
  json5: 'json5',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  env: 'bash',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  tf: 'hcl',
  hcl: 'hcl',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
};

export function getLang(filename: string): string {
  const base = filename.toLowerCase();
  // Handle files with no extension but known names
  const baseName = base.split('/').pop() ?? base;
  if (baseName === 'dockerfile') return 'dockerfile';
  if (baseName === 'makefile' || baseName === 'gnumakefile') return 'makefile';
  if (baseName === '.env' || baseName.startsWith('.env.')) return 'bash';

  const dot = baseName.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = baseName.slice(dot + 1);
  return map[ext] ?? '';
}
