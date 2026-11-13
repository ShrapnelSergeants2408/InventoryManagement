// The shared Drive folder links (SPEC v0.21): checking a typed link, and carrying both in a kit.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb, toHelperRow, toItemRow } from '../src/data/db';
import { buildKit } from '../src/data/helpers';
import { HelperDb, getKit, joinKit } from '../src/data/helper-db';
import { getSettings, setSettings } from '../src/data/settings';
import { checkFolderUrl, folderUrlOrBlank, MAX_FOLDER_URL } from '../src/domain/folder-links';
import { checkKitJson } from '../src/domain/helper-mode';
import type { Helper } from '../src/domain/helpers';
import { readCountKit } from '../src/io/count-kit';
import { item } from './helpers';

const KITS = 'https://drive.google.com/drive/folders/KITS123';
const COUNTS = 'https://drive.google.com/drive/folders/COUNTS456';

describe('checkFolderUrl', () => {
  it('blank means none', () => {
    expect(checkFolderUrl('', 'x')).toEqual({ ok: true, url: '' });
    expect(checkFolderUrl('   ', 'x')).toEqual({ ok: true, url: '' });
  });
  it('accepts an https address and trims it', () => {
    expect(checkFolderUrl(`  ${KITS} `, 'x')).toEqual({ ok: true, url: KITS });
  });
  it('refuses anything else: http, other schemes, words, a very long address', () => {
    for (const bad of ['http://drive.google.com/x', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://a.b/c', 'the Kits folder', 'drive.google.com/drive/folders/1', 'https://']) {
      expect(checkFolderUrl(bad, 'x').ok, bad).toBe(false);
    }
    expect(checkFolderUrl('https://a.example/' + 'x'.repeat(MAX_FOLDER_URL), 'x').ok).toBe(false);
  });
  it('names the field in the message', () => {
    const r = checkFolderUrl('nope', 'The Kits folder link');
    expect(r.ok ? '' : r.error).toMatch(/^The Kits folder link must be a web address/);
  });
});

describe('folderUrlOrBlank (what a kit file may say)', () => {
  it('keeps a valid https link; anything else becomes none', () => {
    expect(folderUrlOrBlank(KITS)).toBe(KITS);
    for (const bad of [undefined, null, 5, '', 'javascript:alert(1)', 'http://x.example']) expect(folderUrlOrBlank(bad), String(bad)).toBe('');
  });
  it('checkKitJson reads both, and ignores a bad one', () => {
    const base = { format: 'frc2408-count-kit', format_version: 1, kit_id: 'kit-1', helper_id: 'hp-1', helper_name: 'Maya', created_at: '2026-11-13T10:00:00-06:00', groups: { kind: 'category', names: ['Motors'] } };
    const r = (extra: Record<string, unknown>) => {
      const c = checkKitJson({ ...base, ...extra });
      return c.ok ? [c.kit.kitsFolderUrl, c.kit.countsFolderUrl] : null;
    };
    expect(r({ kits_folder_url: KITS, counts_folder_url: COUNTS })).toEqual([KITS, COUNTS]);
    expect(r({ kits_folder_url: 'javascript:alert(1)' })).toEqual(['', '']);
    expect(r({})).toEqual(['', '']);
  });
});

describe('the links travel in a kit', () => {
  let n = 0;
  const open: Dexie[] = [];
  afterEach(async () => {
    for (const db of open.splice(0)) {
      db.close();
      await Dexie.delete(db.name);
    }
  });
  const maya: Helper = { id: 'hp-MAYA1', name: 'Maya', kind: 'category', groups: ['Motors'], allowNewItems: true, kits: [], lastImportAt: null, created: 1 };

  async function tablet() {
    const db = new InventoryDb(`m26-links-${++n}`);
    open.push(db);
    await db.items.bulkAdd([toItemRow(item({ id: 'A', category: 'Motors' }), 1)]);
    await db.categories.bulkAdd([{ name: 'Motors', order: 0, subcategories: [] }]);
    await db.helpers.add(toHelperRow(maya));
    return db;
  }

  it('are device settings, blank until set', async () => {
    const db = await tablet();
    expect(await getSettings(db)).toMatchObject({ kitsFolderUrl: '', countsFolderUrl: '' });
    await setSettings(db, { kitsFolderUrl: KITS, countsFolderUrl: COUNTS });
    expect(await getSettings(db)).toMatchObject({ kitsFolderUrl: KITS, countsFolderUrl: COUNTS });
  });

  it('the kit carries both and the helper keeps them with its kit', async () => {
    const db = await tablet();
    await setSettings(db, { kitsFolderUrl: KITS, countsFolderUrl: COUNTS });
    const built = await buildKit(db, 'hp-MAYA1', false);
    const read = await readCountKit(new Uint8Array(await built.blob.arrayBuffer()));
    if (!read.ok) throw new Error('kit');
    expect([read.read.kit.kitsFolderUrl, read.read.kit.countsFolderUrl]).toEqual([KITS, COUNTS]);
    const phone = new HelperDb(`m26-links-phone-${++n}`);
    open.push(phone);
    await joinKit(phone, read.read, 1000);
    const kit = await getKit(phone);
    expect([kit?.kitsFolderUrl, kit?.countsFolderUrl]).toEqual([KITS, COUNTS]);
  });

  it('with no links set, kit.json leaves them out (older helpers and kits are unchanged)', async () => {
    const db = await tablet();
    const built = await buildKit(db, 'hp-MAYA1', false);
    const read = await readCountKit(new Uint8Array(await built.blob.arrayBuffer()));
    if (!read.ok) throw new Error('kit');
    expect([read.read.kit.kitsFolderUrl, read.read.kit.countsFolderUrl]).toEqual(['', '']);
  });
});
