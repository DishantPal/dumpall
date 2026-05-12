import { spinner } from './progress.js';

const USER_AGENT = 'dumpall/2.0 (+https://dumpall.pages.dev)';

async function tryPasteRs(content: string): Promise<string | null> {
  const res = await fetch('https://paste.rs/', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
    body: content,
  });
  if (!res.ok) return null;
  return (await res.text()).trim();
}

async function tryDpaste(content: string): Promise<string | null> {
  const body = new URLSearchParams({ content, syntax: 'text', expiry_days: '365' });
  const res = await fetch('https://dpaste.com/api/v2/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: body.toString(),
  });
  if (!res.ok) return null;
  return (await res.text()).trim();
}

const DPASTE_LIMIT = 750 * 1024; // ~750KB raw — dpaste.com rejects above this

export async function shareContent(content: string): Promise<string> {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > DPASTE_LIMIT) {
    const kb = Math.round(bytes / 1024);
    throw new Error(
      `Content too large to share (${kb}KB, limit ~750KB). Use --max-tokens to reduce output size.`,
    );
  }

  const sp = spinner('Uploading...');

  let url = await tryPasteRs(content);
  if (!url) {
    sp.update('paste.rs failed, trying dpaste.com...');
    url = await tryDpaste(content);
  }

  if (!url) {
    sp.fail('All upload services failed');
    throw new Error('Upload failed: paste.rs and dpaste.com both returned errors');
  }

  sp.done(`Shared: ${url}`);
  return url;
}
