// Starter catalog (SPEC §12, F22): a full-backup ZIP whose missing lists are rebuilt from the items.
import type { ReplaceAllInput } from '../data/inventory';
import { DEFAULT_SUPPLIERS, type Supplier } from '../domain/types';
import { readBackupZip, type BundleRead, type PhotoProgress } from './bundle';
import { completeCategories, completeLocations, completeSuppliers } from './lists-csv';

export const SEED_FILE = 'frc2408-starter-catalog-2026-10-17.zip';

export type SeedRead =
  | { ok: true; data: ReplaceAllInput; warnings: string[] }
  | { ok: false; problems: BundleRead['problems'] };

/** Turns a bundle into a complete data set: suppliers, locations and categories filled in from the items. */
export async function readSeed(zip: ArrayBuffer | Uint8Array | Blob, onPhoto?: PhotoProgress): Promise<SeedRead> {
  const read = await readBackupZip(zip, onPhoto);
  if (!read.bundle) return { ok: false, problems: read.problems };
  const b = read.bundle;
  const baseSuppliers: Supplier[] = b.suppliers ?? DEFAULT_SUPPLIERS.map((name) => ({ name, website: '', notes: '' }));
  return {
    ok: true,
    data: {
      items: b.items,
      photos: b.photos,
      suppliers: completeSuppliers(baseSuppliers, b.items).list,
      locations: completeLocations(b.locations ?? [], b.items).list,
      categories: completeCategories(b.categories ?? [], b.items).list,
    },
    warnings: read.warnings,
  };
}
