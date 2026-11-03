// The two parts (SPEC v3.0 §3 "Parts", F1, F2, F21): a part's view, moving to the other part,
// reading 0.1.2 data, Find and Browse.
import { describe, expect, it } from 'vitest';
import { buildBrowseView, type GroupLine } from '../src/domain/browse';
import { NO_FILTERS } from '../src/domain/filters';
import { findIn } from '../src/domain/find';
import { binToPart, DEFAULT_CATEGORIES, fromV2, itemToPart, partOfRecord, partView } from '../src/domain/parts';
import { area, bin, categories, item, season, spot } from './helpers';

/** Holiday: Storage room › Rack 1 › S-02 Christmas lights. Household: Garage (G) › Pegboard › G-03 Cords. */
function twoParts() {
  const areas = [area({ id: 'ar-store', part: 'holiday', name: 'Storage room', code: 'S' }), area({ id: 'ar-garage', part: 'household', name: 'Garage', code: 'G' })];
  const spots = [spot({ id: 'sp-rack', areaId: 'ar-store', name: 'Rack 1' }), spot({ id: 'sp-peg', areaId: 'ar-garage', name: 'Pegboard' })];
  const bins = [bin({ id: 'bn-s2', part: 'holiday', code: 'S-02', name: 'Christmas lights', spotId: 'sp-rack', seasonId: 'se-xmas' }), bin({ id: 'bn-g3', part: 'household', code: 'G-03', name: 'Cords & cables', spotId: 'sp-peg' })];
  const items = [
    item({ id: 'i-icicle', name: 'Icicle lights', binId: 'bn-s2', quantity: 6 }),
    item({ id: 'i-ext', name: 'Outdoor extension cord', binId: 'bn-s2' }),
    item({ id: 'i-cord', part: 'household', name: 'Extension cord, 50 ft', category: 'Tools', spotId: 'sp-peg', quantity: 2 }),
    item({ id: 'i-cord2', part: 'household', name: 'Outdoor extension cord', category: 'Tools', binId: 'bn-g3' }),
  ];
  const seasons = [season({ id: 'se-xmas' })];
  const tags = [
    { part: 'holiday' as const, name: 'Fragile', order: 0 },
    { part: 'household' as const, name: 'Heavy', order: 0 },
  ];
  return { areas, spots, bins, items, seasons, tags, categories: categories() };
}

describe("a part's view (F21)", () => {
  const d = twoParts();
  it('keeps only that part: areas and their spots, bins, items, lists; seasons in Holiday only', () => {
    const h = partView(d, 'household');
    expect([h.areas.map((a) => a.id), h.spots.map((s) => s.id), h.bins.map((b) => b.id), h.items.map((i) => i.id)]).toEqual([['ar-garage'], ['sp-peg'], ['bn-g3'], ['i-cord', 'i-cord2']]);
    expect(h.seasons).toEqual([]);
    expect(h.tags.map((t) => t.name)).toEqual(['Heavy']);
    expect(h.categories.every((c) => c.part === 'household')).toBe(true);
    const x = partView(d, 'holiday');
    expect(x.seasons.map((s) => s.id)).toEqual(['se-xmas']);
    expect(x.items.map((i) => i.id)).toEqual(['i-icicle', 'i-ext']);
  });
  it('tells which part any record is in', () => {
    expect(['i-cord', 'bn-s2', 'sp-peg', 'ar-store', 'nope'].map((id) => partOfRecord(d, id))).toEqual(['household', 'holiday', 'household', 'holiday', null]);
  });
});

describe('moving to the other part (§3)', () => {
  const cats = [...categories(['Lights', 'Other']), { part: 'household' as const, name: 'Electrical', order: 5, subcategories: ['Cords'] }];
  it('Holiday → Household: season, displays, check date and tags cleared; category matched by name', () => {
    const it1 = item({ category: 'lights', subcategory: 'Outdoor', seasonId: 'se-xmas', displayId: 'dp-1', outDisplayId: 'dp-1', checkedAt: 5, tags: ['Fragile'] });
    expect(itemToPart(it1, 'household', cats)).toMatchObject({ part: 'household', category: 'Lights', subcategory: '', seasonId: '', displayId: '', outDisplayId: '', checkedAt: null, tags: [] });
  });
  it('no matching category: "Other"; a matching subcategory is kept', () => {
    expect(itemToPart(item({ category: 'Ornaments' }), 'household', cats).category).toBe('Other');
    expect(itemToPart(item({ category: 'Electrical', subcategory: 'cords' }), 'household', cats)).toMatchObject({ category: 'Electrical', subcategory: 'Cords' });
    expect(itemToPart(item({ category: 'Ornaments' }), 'household', [])).toMatchObject({ category: 'Other' });
  });
  it('the same part changes nothing; a bin loses its season and tags', () => {
    const it1 = item({ seasonId: 'se-xmas' });
    expect(itemToPart(it1, 'holiday', cats)).toBe(it1);
    expect(binToPart(bin({ seasonId: 'se-xmas', tags: ['Fragile'] }), 'household')).toMatchObject({ part: 'household', seasonId: '', tags: [] });
  });
});

describe('0.1.2 data in two parts (§3 "Upgrading a 0.1.2 phone")', () => {
  it('everything Household, seasons kept with default dates, household seasons cleared, Holiday categories added', () => {
    const strip = <T extends object, K extends keyof T>(x: T, ...keys: K[]) => {
      const o = { ...x };
      for (const k of keys) delete o[k];
      return o as Omit<T, K>;
    };
    const v2 = {
      areas: [{ ...strip(area({ id: 'ar-1', name: 'Storage room' }), 'part', 'code'), letter: 'A' }],
      spots: [spot({ id: 'sp-1', areaId: 'ar-1' })],
      bins: [strip(bin({ id: 'bn-1', spotId: 'sp-1', seasonId: 'se-1', code: 'A-07', labelPrintedAt: 5, labelContents: 'x' }), 'part'), strip(bin({ id: 'bn-2', code: 'Q-01' }), 'part')],
      items: [strip(item({ id: 'i-1', binId: 'bn-1', seasonId: 'se-1' }), 'part', 'displayId', 'outDisplayId', 'checkedAt')],
      seasons: [strip(season({ id: 'se-1', name: 'Easter' }), 'setupFrom', 'takedownBy')],
      tags: [{ name: 'Fragile', order: 0 }],
      categories: [{ name: 'Decorations', order: 0, subcategories: [] }],
      photos: [],
    };
    const d = fromV2(v2);
    expect(d.areas[0]).toMatchObject({ part: 'household', code: 'STORAGE' });
    expect('letter' in d.areas[0]!).toBe(false);
    // A bin of a known letter is renamed and its label counts as not printed; another keeps its code.
    expect(d.bins[0]).toMatchObject({ part: 'household', seasonId: '', code: 'STORAGE-07', labelPrintedAt: null, labelContents: null });
    expect(d.bins[1]!.code).toBe('Q-01');
    expect(d.items[0]).toMatchObject({ part: 'household', seasonId: '', displayId: '', outDisplayId: '', checkedAt: null, binId: 'bn-1' });
    expect(d.seasons[0]).toMatchObject({ name: 'Easter', setupFrom: '03-20', takedownBy: '04-30' });
    expect(d.tags).toEqual([{ part: 'household', name: 'Fragile', order: 0 }]);
    expect(d.categories.map((c) => `${c.part}:${c.name}`)).toEqual(['household:Decorations', ...DEFAULT_CATEGORIES.holiday.map((n) => `holiday:${n}`)]);
    expect(d.photos).toEqual([]);
  });
});

describe('Find (F1, H3 mockup 1)', () => {
  const d = twoParts();
  it('searches the part only, grouped Items / Bins / Spots, with paths', () => {
    const r = findIn(partView(d, 'household'), 'extension');
    expect(r.items.map((x) => [x.item.name, x.path])).toEqual([
      ['Extension cord, 50 ft', 'Garage › Pegboard'],
      ['Outdoor extension cord', 'Garage › Pegboard › G-03 Cords & cables'],
    ]);
    expect(r.bins).toEqual([]);
    expect(r.total).toBe(2);
    // The other part's count for "n matches in Holiday".
    expect(findIn(partView(d, 'holiday'), 'extension').total).toBe(1);
  });
  it('bins by code (also typed "g3"), name and path; spots by name and area', () => {
    const h = partView(d, 'household');
    expect(findIn(h, 'g3').bins.map((b) => [b.bin.code, b.path])).toEqual([['G-03', 'Garage › Pegboard']]);
    expect(findIn(h, 'cords').bins.map((b) => b.bin.code)).toEqual(['G-03']);
    expect(findIn(h, 'peg').spots.map((s) => [s.spot.name, s.path])).toEqual([['Pegboard', 'Garage']]);
    expect(findIn(h, 'garage').total).toBe(4); // two items, the bin and the spot
  });
  it('Holiday also matches seasons; an empty search finds nothing', () => {
    const x = partView(d, 'holiday');
    expect(findIn(x, 'christmas').items.map((i) => i.item.id)).toEqual(['i-icicle', 'i-ext']);
    expect(findIn(x, 'christmas').bins.map((b) => b.bin.id)).toEqual(['bn-s2']);
    expect(findIn(x, '  ').total).toBe(0);
  });
  it('the limit caps each group but not the count', () => {
    const r = findIn(partView(d, 'household'), 'cord', 1);
    expect([r.items.length, r.total]).toEqual([1, 3]);
  });
});

describe('Browse (F2)', () => {
  const d = partView(twoParts(), 'holiday');
  const input = (expanded: string[] = [], filters = NO_FILTERS) => ({ items: d.items, categories: d.categories, places: d, seasons: d.seasons, query: '', filters, expanded: new Set(expanded) });
  const groups = (lines: ReturnType<typeof buildBrowseView>['lines']) => lines.map((l) => (l.kind === 'group' ? `${'  '.repeat(l.level)}${l.name} (${l.total})` : l.kind === 'item' ? `  item ${l.item.name}` : l.kind));

  it('by place: Area › Spot › Bin, collapsed until opened; empty places still listed', () => {
    const closed = buildBrowseView(input(), 'place');
    expect(groups(closed.lines)).toEqual(['Storage room (2)']);
    const keys = closed.lines.map((l) => (l as GroupLine).key);
    const rack = JSON.stringify(['place', 'sp-rack']);
    const s2 = JSON.stringify(['place', 'bn-s2']);
    expect(groups(buildBrowseView(input([...keys, rack, s2]), 'place').lines)).toEqual(['Storage room (2)', '  Rack 1 (2)', '    S-02 Christmas lights (2)', '  item Icicle lights', '  item Outdoor extension cord']);
    expect(closed.shownIds).toEqual(['i-icicle', 'i-ext']);
  });

  it('by place: loose items under their spot; bins with no spot and "No home yet" last', () => {
    const extra = { ...d, bins: [...d.bins, bin({ id: 'bn-x', code: 'S-09', name: 'Spare', spotId: '' })], items: [...d.items, item({ id: 'i-loose', name: 'Wreath', spotId: 'sp-rack' }), item({ id: 'i-none', name: 'Star' })] };
    const v = buildBrowseView({ ...input(), items: extra.items, places: extra, filters: { ...NO_FILTERS, status: 'stored' } }, 'place');
    expect(groups(v.lines)).toEqual([
      'Storage room (3)',
      '  Rack 1 (3)',
      '    S-02 Christmas lights (2)',
      '  item Icicle lights',
      '  item Outdoor extension cord',
      '  item Wreath',
      'Bins with no spot (0)',
      'No home yet (1)',
      '  item Star',
    ].filter((l) => l !== 'Bins with no spot (0)'));
  });

  it('by season: Season › its bins, then "Not in a bin", then "No season"', () => {
    const extra = { ...d, items: [...d.items, item({ id: 'i-wreath', name: 'Wreath', seasonId: 'se-xmas' }), item({ id: 'i-plain', name: 'Ladder hooks' })] };
    const v = buildBrowseView({ ...input(), items: extra.items, places: extra, filters: { ...NO_FILTERS, attention: false, status: 'stored' } }, 'season');
    expect(groups(v.lines)).toEqual([
      'Christmas (3)',
      '  S-02 Christmas lights (2)',
      '  item Icicle lights',
      '  item Outdoor extension cord',
      '  Not in a bin (1)',
      '  item Wreath',
      'No season (1)',
      '  Not in a bin (1)',
      '  item Ladder hooks',
    ]);
  });

  it('by category is the Inventory view', () => {
    expect(buildBrowseView(input(), 'category').lines[0]).toMatchObject({ kind: 'category', name: 'Decorations', total: 2 });
  });
});
