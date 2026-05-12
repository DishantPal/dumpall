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

async function tryLitterbox(content: string): Promise<string | null> {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('time', '72h');
  form.append('fileToUpload', new Blob([content], { type: 'text/plain' }), 'dumpall.txt');
  const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT },
    body: form,
  });
  if (!res.ok) return null;
  return (await res.text()).trim();
}

export async function shareContent(content: string): Promise<string> {
  const sp = spinner('Uploading...');

  let url = await tryPasteRs(content);
  if (!url) {
    sp.update('Uploading to litterbox...');
    url = await tryLitterbox(content);
  }

  if (!url) {
    sp.fail('Upload failed');
    throw new Error('Upload failed: all services unavailable. Try again later.');
  }

  sp.done(`Shared: ${url}`);
  return url;
}
