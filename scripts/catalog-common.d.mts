export type Row = Record<string, string>;
export interface Supplier {
  name: string;
  website: string;
  notes?: string;
}
export interface ShopifyVendor {
  supplier: Supplier;
  site: string;
  skipTypes?: Set<string>;
  imageWidth?: number;
  exclude(product: unknown, include: Set<string>): string | null;
  categoryFor(product: unknown): { category: string; subcategory: string; mapped: boolean; key: string };
  packSize?(title: string, sku: string): number;
}
export interface Cfg {
  discontinued: RegExp | null;
  programs: RegExp | null;
  frc: RegExp | null;
  software: RegExp | null;
  merchandise: RegExp | null;
  game: RegExp | null;
  tools: RegExp | null;
  bundleGroup: RegExp | null;
}
export const COLUMNS: string[];
export const COLLAPSE_OVER: number;
export const SKIP_TYPES: Set<string>;
export const KEYWORD_CATEGORIES: [RegExp, string, string][];
export function priceText(raw: unknown): string;
export function toCsv(columns: string[], rows: Row[]): string;
export function categoriesCsv(rows: Row[]): string;
export function suppliersCsv(supplier: Supplier): string;
export function buildCatalogZip(rows: Row[], photos: Map<string, Uint8Array> | undefined, supplier: Supplier): Promise<Uint8Array>;
export function robotsAllows(text: string, path: string): boolean;
export function robotsCrawlDelay(text: string): number;
export function packSizeFrom(title: unknown, sku?: unknown): number;
export function fileStem(s: unknown): string;
export function shopifyImageFor(product: unknown, width?: number): { url: string; file: string } | null;
export function keywordCategory(text: unknown): { category: string; subcategory: string } | null;
export function isAssembly(title: unknown): boolean;
export function commonExclusion(product: unknown, include: Set<string>, cfg: Cfg): string | null;
export function shopifyRows(
  products: unknown[] | undefined,
  today: string,
  vendor: ShopifyVendor,
  options?: { images?: boolean; include?: Set<string>; collapseOver?: number },
): { rows: Row[]; skipped: { title: string; reason: string }[]; unmapped: Map<string, number> };
