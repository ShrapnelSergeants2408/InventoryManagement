import type { ReplaceAllInput } from '../src/data/inventory';
import { emptyData } from '../src/domain/integrity';
import { blankItem, type Area, type Bin, type Item, type Season, type Spot } from '../src/domain/types';

/** Input for replaceAll: nothing but what's given, with the categories items in tests use. */
export function dataset(over: Partial<ReplaceAllInput> = {}): ReplaceAllInput {
  const categories = ['Decorations', 'Lights', 'Tools', 'Motors', 'Other'].map((name, order) => ({ name, order, subcategories: [] as string[] }));
  return { ...emptyData(), categories, images: new Map(), ...over };
}

export function item(over: Partial<Item> = {}): Item {
  return { ...blankItem('it-TEST0001', 'Test item', 'Decorations'), quantity: 0, ...over };
}

export function area(over: Partial<Area> = {}): Area {
  return { id: 'ar-AREA0001', name: 'Attic', letter: 'A', order: 0, notes: '', ...over };
}

export function spot(over: Partial<Spot> = {}): Spot {
  return { id: 'sp-SPOT0001', areaId: 'ar-AREA0001', name: 'Shelf B', order: 0, notes: '', ...over };
}

export function bin(over: Partial<Bin> = {}): Bin {
  return { id: 'bn-BIN00001', code: 'A-01', name: 'Christmas 1', spotId: '', seasonId: '', tags: [], state: 'stored', notes: '', labelPrintedAt: null, labelContents: null, ...over };
}

export function season(over: Partial<Season> = {}): Season {
  return { id: 'se-SEAS0001', name: 'Christmas', order: 0, color: 'red', setupNotes: '', ...over };
}

/**
 * A small household: Attic (A) with Shelf A and Shelf B, Garage (G) with Pegboard, an unused
 * Basement (B). Bin A-04 "Christmas 4" is on Shelf B with the Christmas season; bin A-05 has no spot.
 */
export function household() {
  const areas = [area({ id: 'ar-attic', name: 'Attic', letter: 'A', order: 0 }), area({ id: 'ar-garage', name: 'Garage', letter: 'G', order: 1 }), area({ id: 'ar-base', name: 'Basement', letter: 'B', order: 2 })];
  const spots = [
    spot({ id: 'sp-shelfA', areaId: 'ar-attic', name: 'Shelf A', order: 0 }),
    spot({ id: 'sp-shelfB', areaId: 'ar-attic', name: 'Shelf B', order: 1 }),
    spot({ id: 'sp-peg', areaId: 'ar-garage', name: 'Pegboard', order: 0 }),
  ];
  const seasons = [season({ id: 'se-xmas', name: 'Christmas', order: 1, color: 'red' }), season({ id: 'se-hall', name: 'Halloween', order: 0, color: 'orange' })];
  const bins = [bin({ id: 'bn-xmas4', code: 'A-04', name: 'Christmas 4', spotId: 'sp-shelfB', seasonId: 'se-xmas' }), bin({ id: 'bn-spare', code: 'A-05', name: 'Spare', spotId: '' })];
  return { areas, spots, bins, seasons };
}
