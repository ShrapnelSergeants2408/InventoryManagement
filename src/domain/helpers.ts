// Helper devices on the main tablet (SPEC §3 "Helper", §18.1): who counts which groups, and
// the kits sent to them. Pure, so the rules are unit-tested; data/helpers.ts saves them.
import { NO_LOCATION } from './lists';
import { nameKey, type Category, type Location } from './types';

/** A helper counts categories or locations, never a mix (§18.1). */
export type GroupKind = 'category' | 'location';

/** One count kit sent to a helper (§18.1: each send gets a new kit id). */
export interface SentKit {
  id: string;
  /** kit.json created_at: local date-time with offset (§18.2). Imports compare counts with it (§18.5). */
  createdAt: string;
}

export interface Helper {
  id: string;
  /** Unique ignoring capitals, e.g. "Tablet 2 · Alex & Jordan". Locked once a kit is sent. */
  name: string;
  kind: GroupKind;
  /** Category names, or location names (and "No location"), in list order. */
  groups: string[];
  allowNewItems: boolean;
  /** Oldest first. The last one is "last kit sent". */
  kits: SentKit[];
  /** ms since epoch of the last counts import from this helper (M16c), or null. */
  lastImportAt: number | null;
  created: number;
}

/** What the add / edit form holds. */
export interface HelperDraft {
  name: string;
  kind: GroupKind;
  groups: string[];
  allowNewItems: boolean;
}

export const MAX_HELPER_NAME = 40;

export const KIND_LABEL: Record<GroupKind, { one: string; many: string }> = {
  category: { one: 'category', many: 'categories' },
  location: { one: 'location', many: 'locations' },
};

/** A helper's name can't change once a kit was sent: imports use it to recognize earlier counts (§18.1). */
export const nameLocked = (h: Helper): boolean => h.kits.length > 0;

export const lastKit = (h: Helper): SentKit | null => h.kits.at(-1) ?? null;

/**
 * The groups a helper can be given, in walk order: every category in list order, or every
 * location in walk order and then "No location" (as count-in by location walks them, F24).
 * Locations only once there are any (§18.1).
 */
export function groupChoices(kind: GroupKind, categories: readonly Category[], locations: readonly Location[]): string[] {
  if (kind === 'category') return [...categories].sort((a, b) => a.order - b.order).map((c) => c.name);
  if (locations.length === 0) return [];
  return [...[...locations].sort((a, b) => a.order - b.order).map((l) => l.name), NO_LOCATION];
}

/** Why a helper name can't be used, or null. Unique ignoring capitals (§3). */
export function helperNameProblem(name: string, helpers: readonly Helper[], exceptId?: string): string | null {
  const n = name.trim();
  if (n === '') return 'Give the helper a name, e.g. “Tablet 2 · Alex & Jordan”.';
  if (n.length > MAX_HELPER_NAME) return `Keep the name to ${MAX_HELPER_NAME} characters or fewer.`;
  const clash = helpers.find((h) => h.id !== exceptId && nameKey(h.name) === nameKey(n));
  return clash ? `There’s already a helper called “${clash.name}”.` : null;
}

export type DraftCheck = { ok: true; draft: HelperDraft } | { ok: false; errors: Partial<Record<'name' | 'groups', string>> };

/**
 * Checks a new or edited helper. Groups must be one kind, chosen from `choices` (matched
 * ignoring capitals, taking the list's spelling and order), at least one. When editing a helper
 * whose kit was sent, the name can't change.
 */
export function checkHelper(draft: HelperDraft, helpers: readonly Helper[], choices: readonly string[], editing: Helper | null = null): DraftCheck {
  const errors: Partial<Record<'name' | 'groups', string>> = {};
  const name = draft.name.trim();
  if (editing && nameLocked(editing) && name !== editing.name) {
    errors.name = 'The name can’t change after a kit was sent: imports use it to recognize this helper’s counts. Add a new helper instead.';
  } else {
    const p = helperNameProblem(name, helpers, editing?.id);
    if (p) errors.name = p;
  }
  const wanted = new Set(draft.groups.map(nameKey));
  const groups = choices.filter((c) => wanted.has(nameKey(c)));
  if (wanted.size === 0) errors.groups = `Choose at least one ${KIND_LABEL[draft.kind].one} to count.`;
  else if (groups.length < wanted.size) errors.groups = `Some ${KIND_LABEL[draft.kind].many} aren’t in the list any more. Choose again.`;
  if (errors.name || errors.groups) return { ok: false, errors };
  return { ok: true, draft: { ...draft, name, groups } };
}

/**
 * Groups this draft shares with other helpers of the same kind, with their names: the
 * "both will count it" warning (§18.1).
 */
export function sharedGroups(draft: HelperDraft, helpers: readonly Helper[], exceptId?: string): Array<{ group: string; helpers: string[] }> {
  const out: Array<{ group: string; helpers: string[] }> = [];
  for (const g of draft.groups) {
    const others = helpers.filter((h) => h.id !== exceptId && h.kind === draft.kind && h.groups.some((x) => nameKey(x) === nameKey(g))).map((h) => h.name);
    if (others.length > 0) out.push({ group: g, helpers: others });
  }
  return out;
}

export interface Coverage {
  group: string;
  /** Helper names assigned this group, A–Z. Empty: unassigned (highlighted, §18.1). */
  helpers: string[];
}

/** Every group of one kind with the helpers assigned to it, in walk order (§18.1). */
export function coverage(helpers: readonly Helper[], kind: GroupKind, choices: readonly string[]): Coverage[] {
  return choices.map((group) => ({
    group,
    helpers: helpers
      .filter((h) => h.kind === kind && h.groups.some((g) => nameKey(g) === nameKey(group)))
      .map((h) => h.name)
      .sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' })),
  }));
}

/** A helper's groups that are no longer in the list (removed since it was set up). */
export const missingGroups = (h: Helper, choices: readonly string[]): string[] => {
  const known = new Set(choices.map(nameKey));
  return h.groups.filter((g) => !known.has(nameKey(g)));
};

/** Group (nameKey) → helper names, for the count-in start screen (F24: "each group shows which helper it's assigned to"). */
export function assignedHelpers(helpers: readonly Helper[], kind: GroupKind): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const h of helpers) {
    if (h.kind !== kind) continue;
    for (const g of h.groups) out.set(nameKey(g), [...(out.get(nameKey(g)) ?? []), h.name]);
  }
  return out;
}

/** A category or location renamed on this tablet: helpers that count it follow the new name. */
export function renameGroup(helpers: readonly Helper[], kind: GroupKind, from: string, to: string): Helper[] {
  return helpers.flatMap((h) => {
    if (h.kind !== kind || !h.groups.some((g) => nameKey(g) === nameKey(from))) return [];
    return [{ ...h, groups: h.groups.map((g) => (nameKey(g) === nameKey(from) ? to : g)) }];
  });
}

/** Helpers A–Z, ignoring capitals. */
export function sortHelpers(helpers: readonly Helper[]): Helper[] {
  return [...helpers].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomId(prefix: string, length: number, isTaken: (id: string) => boolean, random: () => number): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = prefix;
    for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length)];
    if (!isTaken(s)) return s;
  }
  throw new Error(`could not find a free ${prefix} id`);
}

/** "hp-" + 5 characters. Pending items a helper adds get "pending-<helper id>-<n>" (§18.3). */
export const newHelperId = (isTaken: (id: string) => boolean, random: () => number = Math.random) => randomId('hp-', 5, isTaken, random);

/** "kit-" + 8 characters; a new one for every send (§18.1). */
export const newKitId = (isTaken: (id: string) => boolean, random: () => number = Math.random) => randomId('kit-', 8, isTaken, random);
