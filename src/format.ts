import type { FileEntry } from './collect.js';

export type OutputFormat = 'md' | 'xml' | 'json';

function buildTree(entries: FileEntry[]): string {
  interface Node {
    children: Map<string, Node>;
  }
  const root: Node = { children: new Map() };

  for (const e of entries) {
    // Normalize path separators
    const parts = e.relPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let cur = root;
    for (const part of parts) {
      if (!cur.children.has(part)) {
        cur.children.set(part, { children: new Map() });
      }
      cur = cur.children.get(part)!;
    }
  }

  const lines: string[] = ['.'];

  function renderNode(node: Node, prefix: string): void {
    const kids = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (let i = 0; i < kids.length; i++) {
      const [name, child] = kids[i];
      const isLast = i === kids.length - 1;
      lines.push(prefix + (isLast ? '└── ' : '├── ') + name);
      renderNode(child, prefix + (isLast ? '    ' : '│   '));
    }
  }

  renderNode(root, '');
  return lines.join('\n');
}

export function generateTree(entries: FileEntry[]): string {
  return buildTree(entries);
}

export function formatMd(entries: FileEntry[], tree?: string): string {
  const parts: string[] = [];
  if (tree !== undefined) {
    parts.push('```\n' + tree + '\n```\n');
  }
  for (const e of entries) {
    parts.push(`# File: ${e.relPath}\n\n\`\`\`${e.lang}\n${e.content}\n\`\`\`\n`);
  }
  return parts.join('\n');
}

export function formatXml(entries: FileEntry[], tree?: string): string {
  const lines: string[] = ['<dumpall>'];
  if (tree !== undefined) {
    lines.push('  <tree>');
    lines.push(tree.split('\n').map(l => '    ' + l).join('\n'));
    lines.push('  </tree>');
  }
  for (const e of entries) {
    lines.push(`  <file path="${e.relPath}" language="${e.lang}">`);
    lines.push('    <![CDATA[');
    lines.push(e.content);
    lines.push('    ]]>');
    lines.push('  </file>');
  }
  lines.push('</dumpall>');
  return lines.join('\n');
}

export function formatJson(entries: FileEntry[], tree?: string): string {
  const obj: Record<string, unknown> = {};
  if (tree !== undefined) {
    obj.tree = tree;
  }
  obj.files = entries.map(e => ({ path: e.relPath, language: e.lang, content: e.content }));
  return JSON.stringify(obj, null, 2);
}

export function format(entries: FileEntry[], fmt: OutputFormat, tree?: string): string {
  switch (fmt) {
    case 'xml': return formatXml(entries, tree);
    case 'json': return formatJson(entries, tree);
    default: return formatMd(entries, tree);
  }
}
