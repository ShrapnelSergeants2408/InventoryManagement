import type { ReplaceAllInput } from '../src/data/inventory';
import { emptyData } from '../src/domain/integrity';
import { PARTS, blankItem, type Area, type Bin, type Category, type Item, type Season, type Spot } from '../src/domain/types';

/** The categories tests use, in both parts. */
export const TEST_CATEGORIES = ['Decorations', 'Lights', 'Tools', 'Motors', 'Other'];

export function categories(names: readonly string[] = TEST_CATEGORIES): Category[] {
  return PARTS.flatMap((part) => names.map((name, order) => ({ part, name, order, subcategories: [] as string[] })));
}

/** Input for replaceAll: nothing but what's given, with the categories items in tests use (both parts). */
export function dataset(over: Partial<ReplaceAllInput> = {}): ReplaceAllInput {
  return { ...emptyData(), categories: categories(), images: new Map(), ...over };
}

/** Test records default to Holiday, where seasons are allowed (SPEC v3.0 §3). */
export function item(over: Partial<Item> = {}): Item {
  return { ...blankItem('it-TEST0001', 'Test item', 'Decorations', 'holiday'), quantity: 0, ...over };
}

export function area(over: Partial<Area> = {}): Area {
  return { id: 'ar-AREA0001', part: 'holiday', name: 'Attic', letter: 'A', order: 0, notes: '', ...over };
}

export function spot(over: Partial<Spot> = {}): Spot {
  return { id: 'sp-SPOT0001', areaId: 'ar-AREA0001', name: 'Shelf B', order: 0, notes: '', ...over };
}

export function bin(over: Partial<Bin> = {}): Bin {
  return { id: 'bn-BIN00001', part: 'holiday', code: 'A-01', name: 'Christmas 1', spotId: '', seasonId: '', tags: [], state: 'stored', notes: '', labelPrintedAt: null, labelContents: null, ...over };
}

export function season(over: Partial<Season> = {}): Season {
  return { id: 'se-SEAS0001', name: 'Christmas', order: 0, color: 'red', setupFrom: '11-25', takedownBy: '01-06', setupNotes: '', ...over };
}

/**
 * A small Holiday household: Attic (A) with Shelf A and Shelf B, Garage (G) with Pegboard, an unused
 * Basement (B). Bin A-04 "Christmas 4" is on Shelf B with the Christmas season; bin A-05 has no spot.
 */
export function household() {
  const areas = [area({ id: 'ar-attic', name: 'Attic', letter: 'A', order: 0 }), area({ id: 'ar-garage', name: 'Garage', letter: 'G', order: 1 }), area({ id: 'ar-base', name: 'Basement', letter: 'B', order: 2 })];
  const spots = [
    spot({ id: 'sp-shelfA', areaId: 'ar-attic', name: 'Shelf A', order: 0 }),
    spot({ id: 'sp-shelfB', areaId: 'ar-attic', name: 'Shelf B', order: 1 }),
    spot({ id: 'sp-peg', areaId: 'ar-garage', name: 'Pegboard', order: 0 }),
  ];
  const seasons = [season({ id: 'se-xmas', name: 'Christmas', order: 1, color: 'red' }), season({ id: 'se-hall', name: 'Halloween', order: 0, color: 'orange', setupFrom: '10-01', takedownBy: '11-05' })];
  const bins = [bin({ id: 'bn-xmas4', code: 'A-04', name: 'Christmas 4', spotId: 'sp-shelfB', seasonId: 'se-xmas' }), bin({ id: 'bn-spare', code: 'A-05', name: 'Spare', spotId: '' })];
  return { areas, spots, bins, seasons };
}
