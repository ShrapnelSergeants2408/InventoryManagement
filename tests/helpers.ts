import type { Item } from '../src/domain/types';

export function item(over: Partial<Item> = {}): Item {
  return {
    id: 'it-TEST0001',
    name: 'Test item',
    category: 'Decorations',
    subcategory: '',
    location: '',
    quantity: 0,
    barcode: '',
    notes: '',
    hasPhoto: false,
    ...over,
  };
}
