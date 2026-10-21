// Starter catalog (SPEC §12, F22): a full-backup ZIP whose missing lists are rebuilt from the items.
import type { ReplaceAllInput } from '../data/inventory';
import { DEFAULT_SUPPLIERS, type Supplier } from '../domain/types';
import { readBackupZip, type BundleRead, type PhotoProgress } from './bundle';
import { completeCategories, completeLocations, completeSuppliers, spellLikeLists } from './lists-csv';

/** The §11 categories (SPEC v0.8); the file carries `categories.csv` in the seed layout (§7). */
export const SEED_FILE = 'frc2408-starter-catalog-2026-10-21.zip';

export type SeedRead =
  | { ok: true; data: ReplaceAllInput; warnings: string[] }
  | { ok: false; problems: BundleRead['problems'] };

/** Turns a bundle into a complete data set: suppliers, locations and categories filled in from the items. */
export async function readSeed(zip: ArrayBuffer | Uint8Array | Blob, onPhoto?: PhotoProgress): Promise<SeedRead> {
  const read = await readBackupZip(zip, onPhoto);
  if (!read.bundle) return { ok: false, problems: read.problems };
  const b = read.bundle;
  const baseSuppliers: Supplier[] = b.suppliers ?? DEFAULT_SUPPLIERS.map((name) => ({ name, website: '', notes: '' }));
  const locations = completeLocations(b.locations ?? [], b.items).list;
  const categories = completeCategories(b.categories ?? [], b.items).list;
  return {
    ok: true,
    data: {
      items: spellLikeLists(b.items, categories, locations),
      photos: b.photos,
      suppliers: completeSuppliers(baseSuppliers, b.items).list,
      locations,
      categories,
    },
    warnings: read.warnings,
  };
}
