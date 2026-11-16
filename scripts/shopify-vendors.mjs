// Thrifty Bot and CTRE (both Shopify stores, SPEC §23.7): what differs from AndyMark. Neither store tags
// its products much, so the rules read titles. Dan's rules (2026-11-16) are the same as for AndyMark: no
// discontinued products, bundles or kits, tools, merchandise, game pieces or pre-orders, and no FTC, FLL or
// Robits products unless tagged FRC; assemblies come in; sizes and ratings are one row each; more than 65
// variants is one row; out-of-stock products stay; the current price is used. Multi-packs get a pack size.
import { COLLAPSE_OVER, commonExclusion, isAssembly, keywordCategory, packSizeFrom } from './catalog-common.mjs';

const FRC = /\bFRC\b|FIRST® Robotics Competition/i;

/** Category for a product whose store gives no usable type: keywords in the title, then in its tags and type. */
function categoryFor(product) {
  const title = String(product?.title ?? '');
  if (isAssembly(title)) return { category: 'Assemblies', subcategory: '', mapped: true, key: title };
  const tags = (Array.isArray(product?.tags) ? product.tags : []).join(' ');
  const found = keywordCategory(title) ?? keywordCategory(`${product?.product_type ?? ''} ${tags}`);
  return found ? { ...found, mapped: true, key: title } : { category: 'Misc', subcategory: '', mapped: false, key: title.slice(0, 70) };
}

const base = (extra) => ({ categoryFor, packSize: packSizeFrom, ...extra });

export const VENDORS = {
  thriftybot: {
    key: 'thriftybot',
    label: 'Thrifty Bot',
    userAgent: 'frc2408-thriftybot-catalog-script',
    ...base({
      supplier: { name: 'Thrifty Bot', website: 'https://www.thethriftybot.com', notes: '' },
      site: 'https://www.thethriftybot.com',
      exclude: (product, include) =>
        commonExclusion(product, include, {
          discontinued: /\bdiscontinued\b|\bEOL\b|end of life/i,
          programs: /\bFTC\b|FIRST® Tech Challenge|\bFLL\b|\bLEGO\b|\bRobits\b/i,
          frc: FRC,
          software: null,
          merchandise: /\b(t-?shirts?|hoodies?|stickers?|gift cards?|mugs?|socks|lanyards?)\b/i,
          game: /\bpre-?orders?\b|\bgame pieces?\b|\bscoring elements?\b|\bfield carpet\b|\b20\d\d (REBUILT|REEFSCAPE|CRESCENDO|CHARGED UP|INFINITE RECHARGE)\b/i,
          tools: /\btools?\b|\bendmills?\b|\bchain breakers?\b/i,
          bundleGroup: null,
        }),
    }),
  },
  ctre: {
    key: 'ctre',
    label: 'CTRE',
    userAgent: 'frc2408-ctre-catalog-script',
    ...base({
      supplier: { name: 'CTRE', website: 'https://store.ctr-electronics.com', notes: 'Also sells many WCP parts' },
      site: 'https://store.ctr-electronics.com',
      // WCP-branded parts sold on this store are included (Dan, 2026-11-16: "allow wcp products sold through other vendors").
      exclude: (product, include) => {
        const found = commonExclusion(product, include, {
          discontinued: /\bdiscontinued\b|\bEOL\b|end of life/i,
          programs: null,
          frc: FRC,
          software: /\b(software|licen[sc]es?|subscriptions?)\b/i,
          merchandise: /\b(gift cards?|t-?shirts?|hoodies?|stickers?|mugs?)\b/i,
          game: /\bpre-?orders?\b|\bfield carpet\b|\b20\d\d (REBUILT|REEFSCAPE|CRESCENDO|CHARGED UP|INFINITE RECHARGE)\b/i,
          tools: /\btools?\b|\bchain breakers?\b|\bcrimp/i,
          bundleGroup: null,
        });
        if (found) return found;
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        // Phoenix licences have part numbers starting LIC-: a licence, not a part.
        return !include.has('software') && variants.length > 0 && variants.every((v) => /^LIC-/i.test(String(v?.sku ?? ''))) ? 'software or license' : null;
      },
    }),
  },
};

export { COLLAPSE_OVER };
