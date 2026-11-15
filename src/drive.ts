import { googleFetch } from './google';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size';
const KEEP = 5;

export interface DriveBackup { id: string; name: string; createdTime: string; size?: string }

export async function listBackups(): Promise<DriveBackup[]> {
  const q = encodeURIComponent("name contains 'kanakku-backup' and trashed = false");
  const res = await googleFetch(`${FILES}?spaces=appDataFolder&q=${q}&orderBy=createdTime desc&pageSize=50&fields=files(id,name,createdTime,size)`, {}, 'Google Drive');
  return (await res.json()).files || [];
}

/** Uploads a backup to the app's private Drive folder and keeps only the newest few. */
export async function uploadBackup(json: string): Promise<DriveBackup> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const boundary = 'kanakku' + Date.now();
  const meta = JSON.stringify({ name: `kanakku-backup-${stamp}.json`, parents: ['appDataFolder'], mimeType: 'application/json' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const res = await googleFetch(UPLOAD, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, 'Google Drive');
  const file = await res.json();
  try {
    const all = await listBackups();
    for (const old of all.slice(KEEP)) await googleFetch(`${FILES}/${old.id}`, { method: 'DELETE' }, 'Google Drive').catch(() => null);
  } catch { /* cleanup is best effort */ }
  return file;
}

export async function downloadBackup(id: string): Promise<string> {
  const res = await googleFetch(`${FILES}/${id}?alt=media`, {}, 'Google Drive');
  return res.text();
}
