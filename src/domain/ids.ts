// Record ids (SPEC v2.0 §3): a prefix + 8 characters from an alphabet without look-alikes,
// random rather than sequential so a deleted record's printed label can never point at a new one.

export const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ITEM_PREFIX = 'it-';
export const ITEM_ID_PATTERN = /^it-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export function newId(prefix: string, isTaken: (id: string) => boolean, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = prefix;
    for (let i = 0; i < 8; i++) s += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
    if (!isTaken(s)) return s;
  }
  throw new Error('could not find a free id');
}

export const newItemId = (isTaken: (id: string) => boolean, random?: () => number) => newId(ITEM_PREFIX, isTaken, random);

export const ID_PREFIX = { item: 'it-', area: 'ar-', spot: 'sp-', bin: 'bn-', season: 'se-', photo: 'ph-', display: 'dp-', task: 'tk-', run: 'sr-' } as const;
export type RecordKind = keyof typeof ID_PREFIX;

/** Any record id this app makes (§3): a known prefix + 8 id characters. */
export const RECORD_ID_PATTERN = /^(it|ar|sp|bn|se|ph|dp|tk|sr)-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/** The record kind an id names, by its prefix; null for anything else. */
export function kindOfId(id: string): RecordKind | null {
  const p = id.slice(0, 3).toLowerCase();
  return (Object.keys(ID_PREFIX) as RecordKind[]).find((k) => ID_PREFIX[k] === p) ?? null;
}
