import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildCatalogZip, categoriesCsv, mapCategory, priceText, productRows, robotsAllows, toCsv } from '../scripts/andymark-lib.mjs';
import { planAddItems, readAddFile } from '../src/io/add-items';

const products = (JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/andymark-products.json', import.meta.url)), 'utf8')) as { products: unknown[] }).products;
const TODAY = '2026-11-16';

describe('AndyMark catalog script (SPEC §23.7)', () => {
  const { rows, skipped, unmapped } = productRows(products, TODAY);

  it('turns products into one row per variant, facts only', () => {
    expect(rows.map((r) => r.name)).toEqual([
      '0.875 in. ID 1.125 in. OD 0.750 in. Long Bushing',
      'Tube Connector Nut for 0.875 In. OD 0.125 in Thick Tubing',
      '10-32 x 0.375 in. Hex Drive Flat Head Cap Screw with Nylon Patch',
      'Example Wheel, "grippy" - 4 in.',
      'Example Wheel, "grippy" - 6 in.',
      'Mystery Part',
      'Mystery Part Two',
      'Free Sample Screw',
    ]);
    expect(rows[0]).toEqual({
      name: '0.875 in. ID 1.125 in. OD 0.750 in. Long Bushing',
      category: 'Mechanical',
      subcategory: 'Bushings',
      unit: 'each',
      preferred_vendor: '1',
      v1_supplier: 'AndyMark',
      v1_part_no: 'am-1779',
      v1_url: 'https://www.andymark.com/products/0875-in-id-1125-in-od-0750-in-long-bushing',
      v1_pack_size: '1',
      v1_pack_price: '9.00',
      v1_price_checked: TODAY,
    });
    // Only these columns: nothing like a description or a photo can be in the file.
    expect(Object.keys(rows[0]!)).toEqual(['name', 'category', 'subcategory', 'unit', 'preferred_vendor', 'v1_supplier', 'v1_part_no', 'v1_url', 'v1_pack_size', 'v1_pack_price', 'v1_price_checked']);
  });

  it('variants get their own part number and a link to the variant', () => {
    const wheels = rows.filter((r) => r.name?.startsWith('Example Wheel'));
    expect(wheels.map((r) => [r.v1_part_no, r.v1_url, r.v1_pack_price])).toEqual([
      ['am-2001', 'https://www.andymark.com/products/example-wheel?variant=111', '10.00'],
      ['am-2002', 'https://www.andymark.com/products/example-wheel?variant=222', '1212.50'],
    ]);
  });

  it('leaves out what is not a part, lists why, and reports types it could not place', () => {
    expect(skipped).toEqual([
      { title: 'Gift Card', reason: 'not a part (Gift Card)' },
      { title: '(no title)', reason: 'no title' },
      { title: 'No Variants', reason: 'no variants' },
    ]);
    expect(unmapped).toEqual(new Map([['Gizmos', 2]]));
    expect(rows.find((r) => r.name === 'Mystery Part')).toMatchObject({ category: 'Misc', subcategory: '' });
  });

  it('a price of zero is no price; prices are plain dollars with two decimals', () => {
    expect(rows.find((r) => r.name === 'Free Sample Screw')!.v1_pack_price).toBe('');
    expect([priceText('9'), priceText('$1,234.5'), priceText('0'), priceText(''), priceText('abc'), priceText(undefined)]).toEqual(['9.00', '1234.50', '', '', '', '']);
  });

  it('maps product types to the team’s categories ignoring capitals, anything else to Misc', () => {
    expect(mapCategory('NUTS')).toEqual({ category: 'Fasteners', subcategory: 'Nuts', mapped: true });
    expect(mapCategory('Gizmos')).toEqual({ category: 'Misc', subcategory: '', mapped: false });
    expect(mapCategory(undefined).category).toBe('Misc');
  });

  it('writes CSV with quotes doubled and a byte order mark', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x, y', b: 'say "hi"' }]);
    expect(csv).toBe('﻿a,b\r\n"x, y","say ""hi"""\r\n');
  });

  it('the ZIP has the three files and no photos', async () => {
    const zip = await JSZip.loadAsync(await buildCatalogZip(rows));
    expect(Object.keys(zip.files).sort()).toEqual(['categories.csv', 'inventory.csv', 'suppliers.csv']);
    expect(await zip.file('suppliers.csv')!.async('string')).toContain('AndyMark,https://www.andymark.com');
    expect(categoriesCsv(rows)).toContain('Mechanical,Bushings,1');
  });

  it('the ZIP is read by Add items from a file with no skipped rows, and plans cleanly', async () => {
    const read = await readAddFile(await buildCatalogZip(rows), 'andymark.zip');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.skipped).toEqual([]);
    expect(read.file.rows).toHaveLength(rows.length);
    expect(read.file.photos.size).toBe(0);
    const plan = planAddItems(read.file, { items: [], suppliers: [{ name: 'AndyMark', website: '', notes: '' }], categories: [{ name: 'Misc', order: 0, subcategories: [] }] });
    expect(plan.newItems).toHaveLength(rows.length);
    expect(plan.present).toEqual([]);
    expect(plan.newSuppliers).toEqual([]);
    expect(plan.newCategories.map((c) => c.name)).toEqual(['Mechanical', 'Fasteners']);
    const wheel = plan.newItems.find((n) => n.item.name.endsWith('6 in.'))!.item;
    expect(wheel.vendors[0]).toMatchObject({ supplier: 'AndyMark', partNo: 'am-2002', packSize: 1, packPriceCents: 121250, priceChecked: TODAY });
    expect(wheel).toMatchObject({ onHand: 0, desired: 0 });
  });
});

describe('robots.txt check', () => {
  const real = [
    'User-agent: GPTBot', 'Disallow: /', '',
    'User-agent: ClaudeBot', 'User-agent: CCBot', 'Disallow: /', '',
    'User-agent: *', 'Content-Signal: search=yes,ai-train=no,use=reference', 'Allow: /', '',
  ].join('\n');

  it('allows everyone when the * group says Allow: / (what AndyMark published on 2026-11-16)', () => {
    expect(robotsAllows(real, '/products.json')).toBe(true);
  });

  it('refuses when the * group disallows the feed, and the longest rule wins', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /products.json\n', '/products.json')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /\nAllow: /products.json\n', '/products.json')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /\n', '/products.json')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.json$\n', '/products.json')).toBe(false);
  });

  it('rules for other agents do not apply, and an empty file allows', () => {
    expect(robotsAllows('User-agent: GPTBot\nDisallow: /\n', '/products.json')).toBe(true);
    expect(robotsAllows('', '/products.json')).toBe(true);
  });
});
