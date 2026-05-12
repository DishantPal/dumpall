import { spinner } from './progress.js';

const USER_AGENT = 'dumpall/2.0 (+https://dumpall.pages.dev)';

export async function shareContent(content: string): Promise<string> {
  const sp = spinner('Uploading to paste.rs...');
  const res = await fetch('https://paste.rs/', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
    body: content,
  });
  if (!res.ok) {
    sp.fail(`paste.rs returned HTTP ${res.status}`);
    throw new Error(`Upload failed: paste.rs returned HTTP ${res.status}`);
  }
  const url = (await res.text()).trim();
  sp.done(`Shared: ${url}`);
  return url;
}
