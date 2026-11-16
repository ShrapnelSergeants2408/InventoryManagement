export const SUPPLIER: string;
export const SITE: string;
export const IMAGE_WIDTH: number;
export const COLLAPSE_OVER: number;
export const CATEGORY_MAP: Record<string, [string, string]>;
export const SKIP_TYPES: Set<string>;
export const COLUMNS: string[];
export function mapCategory(productType: unknown): { category: string; subcategory: string; mapped: boolean };
export function isAssembly(title: unknown): boolean;
export function isCombinedParent(product: unknown): boolean;
export function exclusionReason(product: unknown, options?: { include?: Set<string> }): string | null;
export function imageFor(product: unknown): { url: string; file: string } | null;
export function priceText(raw: unknown): string;
export function productRows(
  products: unknown[] | undefined,
  today: string,
  options?: { images?: boolean; include?: Set<string>; collapseOver?: number },
): { rows: Record<string, string>[]; skipped: { title: string; reason: string }[]; unmapped: Map<string, number> };
export function toCsv(columns: string[], rows: Record<string, string>[]): string;
export function categoriesCsv(rows: Record<string, string>[]): string;
export function suppliersCsv(): string;
export function buildCatalogZip(rows: Record<string, string>[], photos?: Map<string, Uint8Array>): Promise<Uint8Array>;
export function robotsAllows(text: string, path: string): boolean;
