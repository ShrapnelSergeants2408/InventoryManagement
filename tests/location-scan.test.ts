// Location QR codes (SPEC F29, §20): a bin's QR code holds the location's name.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { getItem, loadSnapshot, replaceAll } from '../src/data/inventory';
import { addLocation, updateLocation } from '../src/data/lists';
import { LOCATION_TEXT_MAX, couldBeLocation, findLocation, locationText, resolveScan } from '../src/domain/scan';
import type { Location } from '../src/domain/types';
import { item } from './helpers';

const loc = (name: string, order: number): Location => ({ name, notes: '', order });
const locations = [loc('Electrical 15', 0), loc('Tools 7', 1), loc('Pit cart', 2)];
const found = (raw: string, list = locations) => findLocation(raw, list)?.name ?? null;

describe('matching a scanned location name (F29)', () => {
  it('ignores capitals and extra spaces around and inside', () => {
    expect(found('Tools 7')).toBe('Tools 7');
    expect(found('  tools   7 \n')).toBe('Tools 7');
    expect(found('ELECTRICAL 15')).toBe('Electrical 15');
    expect(found('Electrical\t15')).toBe('Electrical 15');
  });

  it('keeps the spaces in the name: unlike item codes, they are not removed', () => {
    expect(locationText('  Electrical   15 ')).toBe('Electrical 15');
  });

  it('a name matching only with spaces ignored is used when there is exactly one', () => {
    expect(found('Tools7')).toBe('Tools 7');
    expect(found('pitcart')).toBe('Pit cart');
    expect(found('Tools7', [...locations, loc('Too ls7', 3)])).toBeNull();
  });

  it('an exact match wins over a spaceless one', () => {
    expect(found('Tools7', [...locations, loc('Tools7', 3)])).toBe('Tools7');
    expect(found('Tools 7', [...locations, loc('Tools7', 3)])).toBe('Tools 7');
    // Exact ignores capitals too, so it still wins when both spellings exist.
    expect(found('TOOLS 7', [...locations, loc('Tools7', 3)])).toBe('Tools 7');
  });

  it('reports not found for other names, blanks and team item labels', () => {
    expect(found('Tools 8')).toBeNull();
    expect(found('Tools')).toBeNull();
    expect(found('   ')).toBeNull();
    expect(found('2408:Tools 7', [...locations, loc('2408:Tools 7', 3)])).toBeNull();
  });
});

describe('scan resolution with locations (F21, F29)', () => {
  const items = [item({ id: 'st-0063', barcode: '' }), item({ id: 'st-0050', barcode: '722787604386' }), item({ id: 'tm-TOOLS', barcode: 'Tools7X' })];

  it('a location name shows the location, with its spaces', () => {
    const r = resolveScan(' tools 7 ', items, locations);
    expect(r.kind === 'location' ? [r.location.name, r.code] : r.kind).toEqual(['Tools 7', 'tools 7']);
  });

  it('team labels, item ids and barcodes are checked before location names', () => {
    const clash = [...locations, loc('st-0063', 3), loc('722787604386', 4), loc('tools7x', 5)];
    expect(resolveScan('st-0063', items, clash).kind).toBe('item');
    expect(resolveScan('722787604386', items, clash).kind).toBe('item');
    expect(resolveScan('Tools7X', items, clash).kind).toBe('item');
    expect(resolveScan('2408:st-0063', items, clash).kind).toBe('item');
  });

  it('an unknown code keeps its spaced text, for a new location name', () => {
    const r = resolveScan(' Tools   9 ', items, locations);
    expect(r).toEqual({ kind: 'unknown', code: 'Tools9', text: 'Tools 9' });
  });

  it('without locations (count-in scan mode) nothing changes', () => {
    expect(resolveScan('Tools 7', items).kind).toBe('unknown');
  });
});

describe('which unknown codes offer Add and Rename (F29)', () => {
  it('QR codes and typed text with a letter', () => {
    expect(couldBeLocation('Tools 7', 'qr_code')).toBe(true);
    expect(couldBeLocation('Electrical 15', null)).toBe(true);
    expect(couldBeLocation('Pit cart', null)).toBe(true);
  });

  it('never manufacturer barcodes, digits only, web addresses, team labels or long text', () => {
    expect(couldBeLocation('ABC-123', 'code_128')).toBe(false);
    expect(couldBeLocation('012345678905', 'upc_a')).toBe(false);
    expect(couldBeLocation('012345678905', null)).toBe(false);
    expect(couldBeLocation('https://www.revrobotics.com/rev-21-1650/', 'qr_code')).toBe(false);
    expect(couldBeLocation('HTTP://example.com', 'qr_code')).toBe(false);
    expect(couldBeLocation('2408:st-9999', 'qr_code')).toBe(false);
    expect(couldBeLocation('   ', null)).toBe(false);
    expect(couldBeLocation('B'.repeat(LOCATION_TEXT_MAX), 'qr_code')).toBe(true);
    expect(couldBeLocation('B'.repeat(LOCATION_TEXT_MAX + 1), 'qr_code')).toBe(false);
  });
});

describe('adding and renaming by scan (F29 with F25)', () => {
  const setup = async () => {
    const db = new InventoryDb(`t-${Math.random()}`);
    await replaceAll(db, {
      items: [item({ id: 'a1', location: 'Bin F17' }), item({ id: 'a2', location: 'Bin F17' }), item({ id: 'a3', location: '' })],
      suppliers: [{ name: 'REV', website: '', notes: '' }, { name: 'other', website: '', notes: '' }],
      locations: [loc('Bin F17', 0), loc('Shelf', 1)],
      categories: [],
      photos: new Map(),
    });
    return db;
  };

  it('a scanned name is added at the end of the walk order, spaces kept', async () => {
    const db = await setup();
    const added = await addLocation(db, locationText('  Tools   7 '));
    expect(added).toEqual({ name: 'Tools 7', notes: '', order: 2 });
    const snap = await loadSnapshot(db);
    expect(snap.locations.map((l) => l.name)).toEqual(['Bin F17', 'Shelf', 'Tools 7']);
    expect(findLocation('tools 7', snap.locations)?.name).toBe('Tools 7');
  });

  it('renaming a location to a scanned name moves its items, and the next scan finds it', async () => {
    const db = await setup();
    await updateLocation(db, 'Bin F17', locationText('Electrical 15'), '');
    expect((await getItem(db, 'a1'))!.location).toBe('Electrical 15');
    expect((await getItem(db, 'a2'))!.location).toBe('Electrical 15');
    expect((await getItem(db, 'a3'))!.location).toBe('');
    const snap = await loadSnapshot(db);
    expect(snap.locations[0]).toEqual({ name: 'Electrical 15', notes: '', order: 0 });
    expect(resolveScan('ELECTRICAL 15', snap.items, snap.locations).kind).toBe('location');
  });
});
