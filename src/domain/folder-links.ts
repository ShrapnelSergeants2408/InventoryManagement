// The team's shared Drive folders (v0.21): the shop tablet keeps a link to the folder that holds
// the count kits and one to the folder that holds the counts files, so helpers and mentors open
// the right folder in one tap instead of hunting for the files. Only https links are accepted.

export const MAX_FOLDER_URL = 500;

export type FolderCheck = { ok: true; url: string } | { ok: false; error: string };

/** A typed link: '' (none) or an https address. */
export function checkFolderUrl(raw: string, label: string): FolderCheck {
  const t = raw.trim();
  if (t === '') return { ok: true, url: '' };
  if (t.length > MAX_FOLDER_URL) return { ok: false, error: `${label} is too long (most ${MAX_FOLDER_URL} characters)` };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, error: `${label} must be a web address like https://drive.google.com/drive/folders/…` };
  }
  if (u.protocol !== 'https:' || u.hostname === '') return { ok: false, error: `${label} must start with https://` };
  return { ok: true, url: t };
}

/** A link read from a file or the database: the address when it is a valid https link, else ''. */
export function folderUrlOrBlank(v: unknown): string {
  return typeof v === 'string' && v !== '' && checkFolderUrl(v, '').ok ? v.trim() : '';
}
