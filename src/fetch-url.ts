import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import picomatch from 'picomatch';

const USER_AGENT =
  'Mozilla/5.0 (compatible; dumpall/2.0; +https://dumpall.pages.dev)';

export interface FetchedPage {
  content: string;
  title: string;
  url: string;
}

export async function fetchUrl(url: string): Promise<FetchedPage> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

  let title = document.title ?? '';
  let content: string;

  try {
    const reader = new Readability(document);
    const article = reader.parse();
    if (article && article.content) {
      title = article.title ?? title;
      content = td.turndown(article.content);
    } else {
      throw new Error('Readability returned null');
    }
  } catch {
    // Fallback: use body innerText
    const body = document.body;
    content = body ? td.turndown(body.innerHTML) : html;
  }

  return { content, title, url };
}

// ---- Sitemap-based URL glob expansion ----

async function fetchSitemap(domain: string): Promise<string[] | null> {
  const candidates = [
    `${domain}/sitemap.xml`,
    `${domain}/sitemap_index.xml`,
  ];

  for (const sitemapUrl of candidates) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const xml = await res.text();
      // Extract all <loc>...</loc> entries
      const locs: string[] = [];
      const locRegex = /<loc>([\s\S]*?)<\/loc>/gi;
      let m: RegExpExecArray | null;
      while ((m = locRegex.exec(xml)) !== null) {
        locs.push(m[1].trim());
      }
      if (locs.length > 0) return locs;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function fetchUrlGlob(
  pattern: string,
  opts: { maxPages?: number; noCache?: boolean } = {},
): Promise<FetchedPage[]> {
  const maxPages = opts.maxPages ?? 50;

  // Extract base domain from pattern
  // pattern might be like https://docs.react.dev/learn/**
  const urlMatch = pattern.match(/^(https?:\/\/[^/]+)/);
  if (!urlMatch) {
    throw new Error(`Cannot determine domain from URL pattern: ${pattern}`);
  }
  const domain = urlMatch[1];

  const locs = await fetchSitemap(domain);
  if (!locs) {
    throw new Error(`No sitemap found at ${domain}/sitemap.xml. Cannot expand URL glob.`);
  }

  // Filter locs using picomatch against the glob pattern
  const isMatch = picomatch(pattern, { dot: true });
  const matched = locs.filter(loc => isMatch(loc));

  const toFetch = matched.slice(0, maxPages);
  const total = toFetch.length;

  process.stderr.write(`↓ Fetching ${total} pages matching ${pattern}\n`);

  const results: FetchedPage[] = [];
  const BATCH_SIZE = 5;
  const DELAY_MS = 200;

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (url, idx) => {
        const pageNum = i + idx + 1;
        process.stderr.write(`↓ Fetching page ${pageNum}/${total}...\n`);
        try {
          return await fetchUrl(url);
        } catch (e) {
          process.stderr.write(`warn: failed to fetch ${url}: ${(e as Error).message}\n`);
          return null;
        }
      }),
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    if (i + BATCH_SIZE < toFetch.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}

export function isUrlGlob(arg: string): boolean {
  return (arg.startsWith('http://') || arg.startsWith('https://')) &&
    (arg.includes('*'));
}

export function isUrl(arg: string): boolean {
  return arg.startsWith('http://') || arg.startsWith('https://');
}
