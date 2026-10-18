// Ids for team-added items (spec-questions D1): "tm-" + 5 characters from an
// alphabet without look-alikes, random rather than sequential so a deleted item's
// printed label can never point at a new item.

export const TEAM_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TEAM_ID_PATTERN = /^tm-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;

export function newTeamId(isTaken: (id: string) => boolean, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = 'tm-';
    for (let i = 0; i < 5; i++) s += TEAM_ID_ALPHABET[Math.floor(random() * TEAM_ID_ALPHABET.length)];
    if (!isTaken(s)) return s;
  }
  throw new Error('could not find a free item id');
}
