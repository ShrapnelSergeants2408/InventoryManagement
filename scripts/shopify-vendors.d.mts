import type { ShopifyVendor } from './catalog-common.mjs';
export const VENDORS: Record<string, ShopifyVendor & { key: string; label: string; userAgent: string }>;
