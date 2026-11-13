// Helper devices on the main tablet (SPEC §3 "Helper", §18.1): who counts which groups, and
// the kits sent to them. Pure, so the rules are unit-tested; data/helpers.ts saves them.
import { NO_LOCATION, NO_SUBCATEGORY } from './lists';
import { nameKey, type Category, type Location } from './types';

/** A helper counts categories or locations, never a mix (§18.1). */
export type GroupKind = 'category' | 'location';

/**
 * A helper that counts categories can be limited to some subcategories of one (v0.22): category
 * name → the subcategories it counts, with NO_SUBCATEGORY for the items directly under the
 * category. A category with no entry is counted whole.
 */
export type SubGroups = Record<string, string[]>;

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
  /** Subcategories counted instead of the whole category, for category helpers (v0.22). Absent: every category whole. */
  subcategories?: SubGroups;
  allowNewItems: boolean;
  /** Oldest first. The last one is "last kit sent". */
  kits: SentKit[];
  /** ms since epoch of the last counts import from this helper (M16c), or null. */
  lastImportAt: number | null;
  created: number;
  /** Kit id → the device ids counts files of that kit have come from (v0.19). Absent before the first such import. */
  devices?: Record<string, string[]>;
}

/** What the add / edit form holds. */
export interface HelperDraft {
  name: string;
  kind: GroupKind;
  groups: string[];
  subcategories?: SubGroups;
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
export function checkHelper(draft: HelperDraft, helpers: readonly Helper[], choices: readonly string[], editing: Helper | null = null, subChoices?: SubChoices): DraftCheck {
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
const subs = errors.groups ? undefined : checkSubcategories(draft, groups, subChoices);  if (subs && !subs.ok) errors.groups = subs.error;  if (errors.name || errors.groups) return { ok: false, errors };  const { subcategories: _drop, ...rest } = draft;  const limits = subs?.ok ? subs.value : undefined;  return { ok: true, draft: { ...rest, name, groups, ...(limits ? { subcategories: limits } : {}) } };
}

/** Category → the subcategories a helper can be limited to, in list order (v0.22). */
export type SubChoices = Record<string, string[]>;

/**
 * Every category's subcategory choices: the list's subcategories, any an item uses that the list
 * doesn't have, and "No subcategory" when items sit directly under the category.
 */
export function subcategoryChoices(categories: readonly Category[], items: ReadonlyArray<{ category: string; subcategory: string }>): SubChoices {
  const out: SubChoices = {};
  for (const c of categories) {
    const mine = items.filter((i) => i.category === c.name);
    const names = [...c.subcategories];
    for (const i of mine) if (i.subcategory !== '' && !names.some((n) => nameKey(n) === nameKey(i.subcategory))) names.push(i.subcategory);
    if (mine.some((i) => i.subcategory === '')) names.push(NO_SUBCATEGORY);
    out[c.name] = names;
  }
  return out;
}

const subsFor = (subs: SubGroups | undefined, group: string): string[] | null => {
  if (!subs) return null;
  const key = Object.keys(subs).find((k) => nameKey(k) === nameKey(group));
  return key === undefined ? null : subs[key]!;
};

/** The subcategories counted in one category, or null when all of it is (v0.22). */
export const subcategoriesOf = (h: { subcategories?: SubGroups }, group: string): string[] | null => subsFor(h.subcategories, group);

/** Whether an item's subcategory is one of these (NO_SUBCATEGORY matches an item with none). */
export const inSubcategories = (item: { subcategory?: string }, subs: readonly string[]): boolean =>
  subs.some((s) => (s === NO_SUBCATEGORY ? (item.subcategory ?? '') === '' : nameKey(s) === nameKey(item.subcategory ?? '')));

function checkSubcategories(draft: HelperDraft, groups: readonly string[], choices?: SubChoices): { ok: true; value: SubGroups | undefined } | { ok: false; error: string } {
  if (draft.kind !== 'category' || !draft.subcategories) return { ok: true, value: undefined };
  const out: SubGroups = {};
  for (const g of groups) {
    const wanted = subsFor(draft.subcategories, g);
    if (wanted === null) continue;
    if (wanted.length === 0) return { ok: false, error: 'Choose at least one subcategory of ' + g + ', or count all of it.' };
    const all = choices ? (subsFor(choices, g) ?? []) : null;
    if (all === null) {
      out[g] = [...wanted];
      continue;
    }
    const keys = new Set(wanted.map(nameKey));
    const picked = all.filter((a) => keys.has(nameKey(a)));
    if (picked.length < keys.size) return { ok: false, error: 'Some subcategories of ' + g + ' aren’t in the list any more. Choose again.' };
    if (picked.length < all.length) out[g] = picked;
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : undefined };
}

/** "Mechanical (Wheels, Gears), Electrical": a helper's groups as shown to people (v0.22). */
export const groupLabels = (h: { groups: readonly string[]; subcategories?: SubGroups }): string[] =>
  h.groups.map((g) => {
    const subs = subsFor(h.subcategories, g);
    return subs ? g + ' (' + subs.join(', ') + ')' : g;
  });

/** Whether two helpers' shares of one category overlap: either counts all of it, or they share a subcategory. */
function overlaps(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return true;
  const keys = new Set(a.map(nameKey));
  return b.some((x) => keys.has(nameKey(x)));
}

/**
 * Groups this draft shares with other helpers of the same kind, with their names: the
 * "both will count it" warning (§18.1).
 */
export function sharedGroups(draft: HelperDraft, helpers: readonly Helper[], exceptId?: string): Array<{ group: string; helpers: string[] }> {
  const out: Array<{ group: string; helpers: string[] }> = [];
  for (const g of draft.groups) {
    const mine = subsFor(draft.subcategories, g);
    const others = helpers
      .filter((h) => h.id !== exceptId && h.kind === draft.kind && h.groups.some((x) => nameKey(x) === nameKey(g)) && overlaps(mine, subsFor(h.subcategories, g)))
      .map((h) => h.name);
    if (others.length > 0) out.push({ group: g, helpers: others });
  }
  return out;
}

export interface Coverage {
  group: string;
  /** Helper names assigned this group, A–Z, with their subcategories when they count only some (v0.22). Empty: unassigned (highlighted, §18.1). */
  helpers: string[];
  /** Two or more helpers count the same items (their shares overlap). */
  overlap: boolean;
  /** Subcategories nobody counts, when helpers count only parts of the category (v0.22). */
  uncovered: string[];
}

/** Every group of one kind with the helpers assigned to it, in walk order (§18.1). */
export function coverage(helpers: readonly Helper[], kind: GroupKind, choices: readonly string[], subChoices?: SubChoices): Coverage[] {
  return choices.map((group) => {
    const mine = helpers.filter((h) => h.kind === kind && h.groups.some((g) => nameKey(g) === nameKey(group)));
    const parts = mine.map((h) => ({ name: h.name, subs: kind === 'category' ? subsFor(h.subcategories, group) : null }));
    const sorted = [...parts].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
    const covered = new Set(parts.flatMap((p) => p.subs ?? []).map(nameKey));
    const whole = parts.some((p) => p.subs === null);
    const all = subChoices ? (subsFor(subChoices, group) ?? []) : [];
    return {
      group,
      helpers: sorted.map((p) => (p.subs ? p.name + ' (' + p.subs.join(', ') + ')' : p.name)),
      overlap: parts.some((p, i) => parts.slice(i + 1).some((q) => overlaps(p.subs, q.subs))),
      uncovered: parts.length > 0 && !whole ? all.filter((a) => !covered.has(nameKey(a))) : [],
    };
  });
}

/** A helper's groups that are no longer in the list (removed since it was set up). */
export const missingGroups = (h: Helper, choices: readonly string[], subChoices?: SubChoices): string[] => {
  const known = new Set(choices.map(nameKey));
  const gone = h.groups.filter((g) => !known.has(nameKey(g)));
  if (!subChoices) return gone;
  for (const g of h.groups) {
    if (gone.includes(g)) continue;
    const have = new Set((subsFor(subChoices, g) ?? []).map(nameKey));
    for (const x of subsFor(h.subcategories, g) ?? []) if (!have.has(nameKey(x))) gone.push(g + ' › ' + x);
  }
  return gone;
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
    const renamed: Helper = { ...h, groups: h.groups.map((g) => (nameKey(g) === nameKey(from) ? to : g)) };
    if (h.subcategories) renamed.subcategories = Object.fromEntries(Object.entries(h.subcategories).map(([k, v]) => [nameKey(k) === nameKey(from) ? to : k, v]));
    return [renamed];
  });
}

/** A subcategory renamed on this tablet: helpers limited to it follow the new name (v0.22). */
export function renameSubgroup(helpers: readonly Helper[], category: string, from: string, to: string): Helper[] {
  return helpers.flatMap((h) => {
    const subs = h.kind === 'category' ? subsFor(h.subcategories, category) : null;
    if (!subs || !subs.some((x) => nameKey(x) === nameKey(from))) return [];
    const key = Object.keys(h.subcategories!).find((k) => nameKey(k) === nameKey(category))!;
    return [{ ...h, subcategories: { ...h.subcategories, [key]: subs.map((x) => (nameKey(x) === nameKey(from) ? to : x)) } }];
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

/** "dev-" + 5 characters: a new one every time a kit is opened on a device (§18.2, v0.19). */
export const newDeviceId = (random: () => number = Math.random) => randomId('dev-', 5, () => false, random);

/** "kit-" + 8 characters; a new one for every send (§18.1). */
export const newKitId = (isTaken: (id: string) => boolean, random: () => number = Math.random) => randomId('kit-', 8, isTaken, random);
