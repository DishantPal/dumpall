import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import picomatch from 'picomatch';
import { spinner } from './progress.js';

const USER_AGENT =
  'Mozilla/5.0 (compatible; dumpall/2.0; +https://dumpall.pages.dev)';

export interface FetchedPage {
  content: string;
  title: string;
  url: string;
}

export async function fetchUrl(url: string, quiet = false): Promise<FetchedPage> {
  const sp = quiet ? null : spinner(`Fetching ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });

  if (!res.ok) {
    sp?.fail(`HTTP ${res.status} — ${url}`);
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

  sp?.done(`${title || url}`);
  return { content, title, url };
}

// ---- Sitemap-based URL glob expansion ----

function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const locRegex = /<loc>([\s\S]*?)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = locRegex.exec(xml)) !== null) locs.push(m[1].trim());
  return locs;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex/i.test(xml);
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    // Accept xml or plain text (some servers serve sitemap as text/plain)
    if (!ct.includes('xml') && !ct.includes('text')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const xml = await fetchXml(sitemapUrl);
  if (!xml) return [];
  const locs = extractLocs(xml);
  if (isSitemapIndex(xml)) {
    // Recursively fetch each child sitemap
    const childResults = await Promise.all(locs.map(loc => fetchSitemapUrls(loc, depth + 1)));
    return childResults.flat();
  }
  return locs;
}

async function findSitemapUrls(domain: string): Promise<string[] | null> {
  // 1. Check robots.txt for Sitemap: directives (most reliable)
  const robotsUrls: string[] = [];
  try {
    const res = await fetch(`${domain}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const text = await res.text();
      for (const line of text.split('\n')) {
        const m = line.match(/^Sitemap:\s*(.+)/i);
        if (m) robotsUrls.push(m[1].trim());
      }
    }
  } catch { /* ignore */ }

  // 2. Fall back to well-known paths
  const candidates = [
    ...robotsUrls,
    `${domain}/sitemap.xml`,
    `${domain}/sitemap_index.xml`,
    `${domain}/sitemap/sitemap.xml`,
  ];

  for (const url of candidates) {
    const locs = await fetchSitemapUrls(url);
    if (locs.length > 0) return locs;
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

  const sitemapSp = spinner(`Looking for sitemap at ${domain}...`);
  const locs = await findSitemapUrls(domain);
  if (!locs) {
    sitemapSp.fail(`No sitemap found for ${domain}. Checked robots.txt and common paths.`);
    throw new Error(`No sitemap found for ${domain}. Cannot expand URL glob without a sitemap.`);
  }
  sitemapSp.done(`Found ${locs.length} URLs in sitemap`);

  // Match by path only — picomatch chokes on :// in full URLs.
  // Also normalize www vs non-www so patterns without www match sitemap URLs with www and vice versa.
  const patternPath = pattern.replace(/^https?:\/\/[^/]+/, ''); // e.g. /resources/*
  const patternHost = domain.replace(/^https?:\/\/(www\.)?/, ''); // e.g. parkingmd.com
  const pathMatcher = picomatch(patternPath || '/**', { dot: true });

  const matched = locs.filter(loc => {
    try {
      const u = new URL(loc);
      const locHost = u.hostname.replace(/^www\./, '');
      if (locHost !== patternHost) return false;
      return pathMatcher(u.pathname);
    } catch {
      return false;
    }
  });

  const toFetch = matched.slice(0, maxPages);
  const total = toFetch.length;

  const sp = spinner(`Fetching page 1/${total}...`);
  const results: FetchedPage[] = [];
  const BATCH_SIZE = 5;
  const DELAY_MS = 200;
  let done = 0;

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const page = await fetchUrl(url, true);
          done++;
          sp.update(`Fetching page ${done}/${total}...`);
          return page;
        } catch (e) {
          done++;
          sp.update(`Fetching page ${done}/${total}... (warn: ${(e as Error).message})`);
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

  sp.done(`Fetched ${results.length}/${total} pages`);
  return results;
}

export function isUrlGlob(arg: string): boolean {
  return (arg.startsWith('http://') || arg.startsWith('https://')) &&
    (arg.includes('*'));
}

export function isUrl(arg: string): boolean {
  return arg.startsWith('http://') || arg.startsWith('https://');
}
