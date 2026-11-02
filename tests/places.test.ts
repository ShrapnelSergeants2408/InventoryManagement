// Areas, spots and bins: the pure rules (SPEC v2.0 §3, §4).
import { describe, expect, it } from 'vitest';
import { checkData, unlistedTags, type HouseholdData } from '../src/domain/integrity';
import { RECORD_ID_PATTERN, kindOfId } from '../src/domain/ids';
import {
  binContents,
  defaultLetter,
  indexPlaces,
  itemAreaId,
  itemPath,
  itemSeasonId,
  nextBinCode,
  pathText,
  qtyText,
  sameBinCode,
  tidyBinCode,
} from '../src/domain/places';
import { validateBin, validateItem } from '../src/domain/validate';
import { bin, dataset, household, item } from './helpers';

describe('area letters (§3)', () => {
  it('the first free letter of the name, else the first free letter A–Z', () => {
    expect(defaultLetter('Garage', [])).toBe('G');
    expect(defaultLetter('Garage', ['G'])).toBe('A');
    expect(defaultLetter('Garage', ['G', 'A', 'R', 'E'])).toBe('B');
    expect(defaultLetter('4th floor', [])).toBe('T');
    expect(defaultLetter('x', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'])).toBeNull();
  });
});

describe('bin codes (§3, D4)', () => {
  it('typed codes are tidied: capitals, dash, two digits', () => {
    expect(tidyBinCode('a4')).toBe('A-04');
    expect(tidyBinCode(' b 12 ')).toBe('B-12');
    expect(tidyBinCode('C-007')).toBe('C-07');
    expect(tidyBinCode('A-104')).toBe('A-104');
    expect(tidyBinCode('AB-1')).toBe('AB-1');
    expect(sameBinCode('a-4', 'A-04')).toBe(true);
  });

  it('the next code is one more than the highest with that letter, so a deleted bin’s code isn’t reused', () => {
    expect(nextBinCode('A', [])).toBe('A-01');
    expect(nextBinCode('A', ['A-01', 'A-04', 'G-09'])).toBe('A-05');
    expect(nextBinCode('G', ['A-01', 'A-04', 'G-09'])).toBe('G-10');
    expect(nextBinCode('A', ['A-99'])).toBe('A-100');
  });

  it('a bin must have a well-formed code and a name', () => {
    expect(validateBin(bin())).toEqual([]);
    expect(validateBin(bin({ code: 'A4', name: ' ' })).map((e) => e.field)).toEqual(['name', 'code']);
  });
});

describe('paths and seasons (§4)', () => {
  const ix = indexPlaces(household());
  it('an item in a bin is wherever the bin is; a loose item sits on its spot', () => {
    expect(pathText(itemPath(item({ binId: 'bn-xmas4' }), ix))).toBe('Attic › Shelf B › A-04 Christmas 4');
    expect(pathText(itemPath(item({ spotId: 'sp-peg' }), ix))).toBe('Garage › Pegboard');
    expect(pathText(itemPath(item({ binId: 'bn-spare' }), ix))).toBe('A-05 Spare (no spot)');
    expect(pathText(itemPath(item(), ix))).toBe('No home yet');
    expect(itemPath(item({ binId: 'bn-xmas4' }), ix).map((p) => p.kind)).toEqual(['area', 'spot', 'bin']);
  });

  it('the area of an item’s home, or null', () => {
    expect(itemAreaId(item({ binId: 'bn-xmas4' }), ix)).toBe('ar-attic');
    expect(itemAreaId(item({ binId: 'bn-spare' }), ix)).toBeNull();
    expect(itemAreaId(item(), ix)).toBeNull();
  });

  it('an item’s season is its own, else its bin’s', () => {
    expect(itemSeasonId(item({ binId: 'bn-xmas4' }), ix)).toBe('se-xmas');
    expect(itemSeasonId(item({ binId: 'bn-xmas4', seasonId: 'se-hall' }), ix)).toBe('se-hall');
    expect(itemSeasonId(item({ spotId: 'sp-peg' }), ix)).toBe('');
  });
});

describe('bin contents summary (§4)', () => {
  it('stored items only; largest first, bulk lines first when tied, then A–Z', () => {
    const items = [
      item({ id: '1', name: 'Garland', binId: 'b', quantity: 3 }),
      item({ id: '2', name: 'Ornaments', binId: 'b', quantity: 40, approx: true }),
      item({ id: '3', name: 'bells', binId: 'b', quantity: 3, approx: true }),
      item({ id: '4', name: 'Angel', binId: 'b', quantity: 3 }),
      item({ id: '5', name: 'Wreath', binId: 'b', quantity: 9, status: 'out' }),
      item({ id: '6', name: 'Elsewhere', binId: 'c', quantity: 99 }),
    ];
    expect(binContents(items, 'b')).toEqual(['Ornaments ~40', 'bells ~3', 'Angel ×3', 'Garland ×3']);
    expect(qtyText({ quantity: 2, approx: false })).toBe('×2');
  });
});

describe('record ids (§3)', () => {
  it('the prefix names the kind', () => {
    expect(kindOfId('bn-A1B2C3D4')).toBe('bin');
    expect(kindOfId('sp-A1B2C3D4')).toBe('spot');
    expect(kindOfId('xx-A1B2C3D4')).toBeNull();
    expect(RECORD_ID_PATTERN.test('ar-23456789')).toBe(true);
    expect(RECORD_ID_PATTERN.test('ar-0000000O')).toBe(false);
  });
});

describe('item rules (§3)', () => {
  it('enums, money, dates and tags are checked', () => {
    const bad = item({ status: 'gone' as never, condition: 'meh' as never, value: 1.5, purchaseDate: '2026-02-30', tags: ['a;b'], binId: 'b', spotId: 's' });
    expect(validateItem(bad).map((e) => e.field)).toEqual(['home', 'status', 'condition', 'value', 'purchaseDate', 'tags']);
  });
});

describe('a whole household checked together (restore, setup)', () => {
  const ok = (): HouseholdData => ({ ...dataset({ ...household(), items: [item({ id: 'i1', binId: 'bn-xmas4' })] }) });

  it('a consistent household has no problems', () => {
    expect(checkData(ok())).toEqual([]);
  });

  it('links must point at records that exist', () => {
    const d = ok();
    d.spots[0] = { ...d.spots[0]!, areaId: 'ar-gone' };
    d.bins[0] = { ...d.bins[0]!, seasonId: 'se-gone' };
    d.items.push(item({ id: 'i2', spotId: 'sp-gone', category: 'Nope' }));
    d.photos.push({ id: 'ph-1', ownerType: 'bin', ownerId: 'bn-gone', kind: 'photo', caption: '', order: 0 });
    expect(checkData(d)).toEqual([
      'spot "Shelf A" is in area ar-gone, which isn\'t there',
      'bin A-04 has season se-gone, which isn\'t there',
      'item "Test item" is on spot sp-gone, which isn\'t there',
      'item "Test item" has category "Nope", which isn\'t in the category list',
      'photo ph-1 belongs to bin bn-gone, which isn\'t there',
    ]);
  });

  it('names, letters and codes must be unique where §3 says so', () => {
    const d = ok();
    d.areas.push({ ...d.areas[0]!, id: 'ar-2', name: 'ATTIC', letter: 'G' });
    d.spots.push({ ...d.spots[0]!, id: 'sp-2', name: 'shelf a' });
    d.bins.push({ ...d.bins[0]!, id: 'bn-2', code: 'A-04', name: 'Other' });
    d.seasons.push({ ...d.seasons[0]!, id: 'se-2', name: 'christmas' });
    expect(checkData(d)).toEqual([
      'area "ATTIC" is listed twice (also "Attic")',
      'areas "Garage" and "ATTIC" both use the letter G',
      'spot "shelf a" is listed twice in its area',
      'bin code A-04 is used by two bins ("Christmas 4" and "Other")',
      'season "christmas" is listed twice',
    ]);
  });

  it('tags records use but the list lacks, in first-appearance order', () => {
    expect(unlistedTags({ tags: [{ name: 'Fragile', order: 0 }], bins: [bin({ tags: ['Outdoor'] })], items: [item({ tags: ['fragile', 'Kids'] })] })).toEqual(['Outdoor', 'Kids']);
  });
});
