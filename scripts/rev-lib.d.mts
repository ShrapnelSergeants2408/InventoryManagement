import type { Row, Supplier } from './catalog-common.mjs';
export interface RevOption {
  name: string;
  values: { label: string; sku: string }[];
}
export interface RevPage {
  name: string;
  sku: string;
  price: string;
  availability: string;
  image: string;
  crumbs: string[];
  options: RevOption[];
}
export const SITE: string;
export const SUPPLIER: Supplier;
export function parseProductPage(html: string): RevPage | null;
export function parseOptions(html: string): RevOption[];
export function meaningfulCrumbs(crumbs: string[]): string[];
export function exclusionReason(page: RevPage, include?: Set<string>): string | null;
export function categoryFor(page: RevPage): { category: string; subcategory: string; mapped: boolean; key: string };
export function revImage(page: RevPage, url: string): { url: string; file: string } | null;
export function revRows(
  pages: { url: string; page: RevPage }[],
  today: string,
  options?: { images?: boolean; include?: Set<string>; collapseOver?: number },
): { rows: Row[]; skipped: { title: string; reason: string }[]; unmapped: Map<string, number> };
export function sitemapUrls(xml: string): string[];
