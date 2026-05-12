import { spinner } from './progress.js';

const USER_AGENT = 'dumpall/2.0 (+https://dumpall.pages.dev)';

async function uploadTo0x0(content: string): Promise<string> {
  const body = new FormData();
  body.append('file', new Blob([content], { type: 'text/plain' }), 'dumpall.txt');
  const res = await fetch('https://0x0.st', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT },
    body,
  });
  if (!res.ok) throw new Error(`0x0.st returned HTTP ${res.status}`);
  return (await res.text()).trim();
}

async function uploadToPasteRs(content: string): Promise<string> {
  const res = await fetch('https://paste.rs/', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
    body: content,
  });
  if (!res.ok) throw new Error(`paste.rs returned HTTP ${res.status}`);
  return (await res.text()).trim();
}

export async function shareContent(content: string): Promise<string> {
  const sp = spinner('Uploading to 0x0.st...');
  try {
    const url = await uploadTo0x0(content);
    sp.done(`Shared: ${url}`);
    return url;
  } catch (e1) {
    sp.update('0x0.st failed, trying paste.rs...');
    try {
      const url = await uploadToPasteRs(content);
      sp.done(`Shared: ${url}`);
      return url;
    } catch (e2) {
      sp.fail(`Upload failed: ${(e1 as Error).message} / ${(e2 as Error).message}`);
      throw new Error('All upload services failed');
    }
  }
}
