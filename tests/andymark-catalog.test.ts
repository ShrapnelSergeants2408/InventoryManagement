import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { IMAGE_WIDTH, buildCatalogZip, categoriesCsv, exclusionReason, imageFor, isAssembly, mapCategory, priceText, productRows, robotsAllows, toCsv } from '../scripts/andymark-lib.mjs';
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
      notes: '',
    });
    // Only these columns: nothing like a description or a photo can be in the file.
    expect(Object.keys(rows[0]!)).toEqual(['name', 'category', 'subcategory', 'unit', 'preferred_vendor', 'v1_supplier', 'v1_part_no', 'v1_url', 'v1_pack_size', 'v1_pack_price', 'v1_price_checked', 'notes']);
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
    expect(rows.find((r) => r.name === 'Mystery Part')).toMatchObject({ category: 'Misc', subcategory: 'Gizmos' });
  });

  it('a price of zero is no price; prices are plain dollars with two decimals', () => {
    expect(rows.find((r) => r.name === 'Free Sample Screw')!.v1_pack_price).toBe('');
    expect([priceText('9'), priceText('$1,234.5'), priceText('0'), priceText(''), priceText('abc'), priceText(undefined)]).toEqual(['9.00', '1234.50', '', '', '', '']);
  });

  it('maps product types to the team’s categories ignoring capitals, anything else to Misc', () => {
    expect(mapCategory('NUTS')).toEqual({ category: 'Fasteners', subcategory: 'Nuts', mapped: true });
    expect(mapCategory('Gizmos')).toEqual({ category: 'Misc', subcategory: 'Gizmos', mapped: false });
    expect(mapCategory(undefined)).toEqual({ category: 'Misc', subcategory: '', mapped: false });
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

describe('AndyMark catalog script: what is left out (Dan, 2026-11-16)', () => {
  const part = (over: Record<string, unknown>) => ({ title: 'Part', handle: 'part', product_type: 'Spacers', tags: [], variants: [{ id: 1, title: 'Default Title', sku: 'am-1', price: '1.00' }], ...over });
  const inc = (...what: string[]) => ({ include: new Set(what) });

  it('leaves out discontinued products, by AndyMark’s own tag', () => {
    expect(exclusionReason(part({ tags: ['View All', 'Discontinued'] }))).toBe('discontinued');
    expect(exclusionReason(part({ tags: ['discontinued'] }))).toBe('discontinued');
    expect(exclusionReason(part({ tags: ['Not discontinued soon'] }))).toBeNull();
    expect(exclusionReason(part({ tags: ['Discontinued'] }), inc('discontinued'))).toBeNull();
  });

  it('leaves out bundles and kits: by product type, by tag, or by title', () => {
    expect(exclusionReason(part({ product_type: 'Hardware Bundles' }))).toBe('bundle');
    expect(exclusionReason(part({ tags: ['FIRST® Robotics Competition Bundles'] }))).toBe('bundle');
    expect(exclusionReason(part({ title: 'Robot Power Cable Kit' }))).toBe('bundle or kit');
    expect(exclusionReason(part({ title: 'Electronic Bundles Builder' }))).toBe('bundle or kit');
    expect(exclusionReason(part({ title: 'FRC Basic Starter Bundle' }))).toBe('bundle or kit');
    expect(exclusionReason(part({ title: 'Hex Spacer Kit' }), inc('bundles'))).toBeNull();
  });

  it('keeps an assembly even when AndyMark tags it as a bundle, but not a kit or a part for one', () => {
    const tagged = { tags: ['FIRST® Robotics Competition Bundles'] };
    expect(exclusionReason(part({ ...tagged, title: 'Climber in a Box' }))).toBeNull();
    expect(exclusionReason(part({ ...tagged, title: '6.875 in. Turret Assembly' }))).toBeNull();
    expect(exclusionReason(part({ ...tagged, title: 'AndyMark Robot Cart' }))).toBeNull();
    expect(exclusionReason(part({ ...tagged, title: 'Climber in a Box Swappable Hook Kit' }))).toBe('bundle');
    expect(exclusionReason(part({ ...tagged, title: 'Launcher in a Box Side Plate' }))).toBe('bundle');
    expect(isAssembly('Climber in a Box')).toBe(true);
    expect(isAssembly('Launcher in a Box Side Plate')).toBe(false);
  });

  it('puts an assembly and a swerve module under Assemblies', () => {
    const list = [
      part({ title: 'Climber in a Box', product_type: 'FIRST® Robotics Competition Bundles', tags: ['FIRST® Robotics Competition Bundles'] }),
      part({ title: 'Everypit Battery Holder Assembly', product_type: 'Brackets & Plates' }),
      part({ title: 'SDS MK4i Swerve Modules', product_type: 'Swerve Modules' }),
    ];
    expect(productRows(list, TODAY).rows.map((r) => [r.name, r.category, r.subcategory])).toEqual([
      ['Climber in a Box', 'Assemblies', ''],
      ['Everypit Battery Holder Assembly', 'Assemblies', ''],
      ['SDS MK4i Swerve Modules', 'Assemblies', ''],
    ]);
  });

  it('leaves out FTC, FLL and Robits products unless they are also tagged FRC', () => {
    expect(exclusionReason(part({ product_type: 'FIRST® Tech Challenge 2026-2027 - BIOBUZZ™' }))).toBe('ftc, fll or robits');
    expect(exclusionReason(part({ tags: ['All FTC Parts'] }))).toBe('ftc, fll or robits');
    expect(exclusionReason(part({ product_type: 'Robits' }))).toBe('ftc, fll or robits');
    expect(exclusionReason(part({ title: 'Robits T-Shirt' }))).toBe('ftc, fll or robits');
    expect(exclusionReason(part({ product_type: 'FIRST® LEGO League' }))).toBe('ftc, fll or robits');
    expect(exclusionReason(part({ tags: ['FTC Sensors', 'Release - 2026 Other FRC Kickoff', 'Robits Sensors'] }))).toBeNull();
    expect(exclusionReason(part({ tags: ['All FTC Parts', 'FRC Control System'] }))).toBeNull();
    expect(exclusionReason(part({ tags: ['All FTC Parts'] }), inc('programs'))).toBeNull();
  });

  it('leaves out tools, by AndyMark’s own type or tag', () => {
    expect(exclusionReason(part({ product_type: 'Mechanical Tools' }))).toBe('tool');
    expect(exclusionReason(part({ product_type: 'Batteries & Chargers', tags: ['Electrical Tools'] }))).toBe('tool');
    expect(exclusionReason(part({ product_type: 'Mechanical Tools' }), inc('tools'))).toBeNull();
    expect(exclusionReason(part({ title: 'Tooling Plate', product_type: 'Brackets & Plates' }))).toBeNull();
  });

  it('leaves out parts that ship from outside the US: the "Ships from Sydney" store and its AUS part numbers', () => {
    expect(exclusionReason(part({ title: 'Ships from Sydney - Nut Drivers' }))).toBe('outside the US');
    expect(exclusionReason(part({ title: 'Surface Mount Breaker', variants: [{ id: 1, title: 'Default Title', sku: 'am-0282aAUS', price: '60.00' }] }))).toBe('outside the US');
    expect(exclusionReason(part({ title: 'Mixed', variants: [{ id: 1, sku: 'am-1AUS' }, { id: 2, sku: 'am-2' }] }))).toBeNull();
    expect(exclusionReason(part({ title: 'Ships from Sydney - Nut Drivers' }), inc('international'))).toBeNull();
  });

  it('leaves out merchandise', () => {
    expect(exclusionReason(part({ product_type: 'Merchandise', title: 'AndyMark Socks' }))).toBe('merchandise');
    expect(exclusionReason(part({ product_type: 'Merchandise' }), inc('merchandise'))).toBeNull();
  });

  it('leaves out game pieces and pre-orders: by a season type, or by the title', () => {
    expect(exclusionReason(part({ product_type: 'FIRST® Robotics Competition 2026 REBUILT™' }))).toBe('game piece or pre-order');
    expect(exclusionReason(part({ product_type: '2027 FIRST® Robotics Competition season BIOCORE™' }))).toBe('game piece or pre-order');
    expect(exclusionReason(part({ title: 'REEFSCAPE℠ Game Pieces' }))).toBe('game piece or pre-order');
    expect(exclusionReason(part({ title: 'FIRST Robotics Competition Field Carpet Pre-Order' }))).toBe('game piece or pre-order');
    expect(exclusionReason(part({ title: 'BIOCORE™ FRC Scoring Element Pre-Orders' }))).toBe('game piece or pre-order');
    expect(exclusionReason(part({ product_type: 'FIRST® Robotics Competition 2026 REBUILT™' }), inc('game'))).toBeNull();
    expect(exclusionReason(part({ title: 'Hex Spacers', product_type: 'Spacers' }))).toBeNull();
  });

  it('keeps a part sold in several sizes or ratings, and a pack of the same part', () => {
    expect(exclusionReason(part({ title: 'Traction Wheels', product_type: 'Wheels', tags: ['Traction Wheels', 'View All'] }))).toBeNull();
    expect(exclusionReason(part({ title: 'Machine Key Pack' }))).toBeNull();
    expect(exclusionReason(part({ title: 'Skit Bracket' }))).toBeNull();
  });

  it('lists a row for every size and every durometer', () => {
    const wheels = part({
      title: 'Grip Wheel',
      handle: 'grip-wheel',
      product_type: 'Mecanum & Omni Wheels',
      variants: [
        { id: 1, title: '4 in. / 40A', sku: 'am-w440', price: '10.00' },
        { id: 2, title: '4 in. / 60A', sku: 'am-w460', price: '10.00' },
        { id: 3, title: '6 in. / 40A', sku: 'am-w640', price: '14.00' },
        { id: 4, title: '8 in. / 60A', sku: 'am-w860', price: '18.00' },
      ],
    });
    const { rows } = productRows([wheels], TODAY);
    expect(rows.map((r) => [r.name, r.v1_part_no])).toEqual([
      ['Grip Wheel - 4 in. / 40A', 'am-w440'],
      ['Grip Wheel - 4 in. / 60A', 'am-w460'],
      ['Grip Wheel - 6 in. / 40A', 'am-w640'],
      ['Grip Wheel - 8 in. / 60A', 'am-w860'],
    ]);
  });

  it('productRows leaves them out and says why; include keeps them', () => {
    const list = [part({ title: 'Old', tags: ['Discontinued'] }), part({ title: 'A Bundle', product_type: 'Hardware Bundles' }), part({ title: 'A Tool', product_type: 'Mechanical Tools' }), part({ title: 'Good' })];
    expect(productRows(list, TODAY).skipped).toEqual([
      { title: 'Old', reason: 'discontinued' },
      { title: 'A Bundle', reason: 'bundle' },
      { title: 'A Tool', reason: 'tool' },
    ]);
    expect(productRows(list, TODAY).rows.map((r) => r.name)).toEqual(['Good']);
    expect(productRows(list, TODAY, inc('discontinued', 'bundles', 'tools')).rows).toHaveLength(4);
  });
});

describe('AndyMark catalog script: products with many variants are listed once (Dan, 2026-11-16)', () => {
  const variants = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `Option ${i}`, sku: `am-${i}`, price: `${10 + i}.00` }));
  const product = (over: Record<string, unknown>) => ({ title: 'Swerve Module', handle: 'swerve-module', product_type: 'Swerve Modules', tags: [], options: [{ name: 'Gear Ratio' }, { name: 'Wheel Type' }], variants: variants(70), ...over });

  it('a product with more than 65 variants is one row, "(multiple variants)", with the lowest price and a note', () => {
    const { rows } = productRows([product({})], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Swerve Module (multiple variants)',
      v1_part_no: '',
      v1_url: 'https://www.andymark.com/products/swerve-module',
      v1_pack_price: '10.00',
      notes: '70 variants (Gear Ratio, Wheel Type); choose on the product page. The price is the lowest of them.',
    });
  });

  it('65 variants or fewer are a row per variant (spacers, gussets, belts, a gearbox with 52)', () => {
    expect(productRows([product({ variants: variants(65) })], TODAY).rows).toHaveLength(65);
    expect(productRows([product({ variants: variants(31), title: 'Hex Spacers', handle: 'hex-spacers' })], TODAY).rows).toHaveLength(31);
    expect(productRows([product({ variants: variants(66) })], TODAY).rows.map((r) => r.name)).toEqual(['Swerve Module (multiple variants)']);
  });

  it('an AndyMark combined-listing parent follows the same limit', () => {
    const parent = (n: number) => product({ tags: ['Combined Listing Parent', 'combinedListing-am-X'], variants: variants(n) });
    expect(productRows([parent(12)], TODAY).rows).toHaveLength(12);
    expect(productRows([parent(80)], TODAY).rows).toHaveLength(1);
  });

  it('the child products of a combined listing are left out, since the parent already lists them', () => {
    const child = product({ title: 'Swerve Module - L3 / Billet', tags: ['combinedListing-am-X'], variants: variants(1) });
    expect(exclusionReason(child)).toBe('part of a combined listing');
    expect(productRows([child], TODAY).skipped).toEqual([{ title: 'Swerve Module - L3 / Billet', reason: 'part of a combined listing' }]);
  });

  it('the limit can be changed or turned off', () => {
    expect(productRows([product({ variants: variants(12) })], TODAY, { collapseOver: 10 }).rows).toHaveLength(1);
    expect(productRows([product({ variants: variants(80) })], TODAY, { collapseOver: 0 }).rows).toHaveLength(80);
  });

  it('a one-variant product is never collapsed, and a collapsed row is read by the importer', async () => {
    expect(productRows([product({ variants: variants(1) })], TODAY).rows[0]!.name).toBe('Swerve Module');
    const { rows } = productRows([product({ variants: variants(70) })], TODAY);
    const read = await readAddFile(await buildCatalogZip(rows), 'a.zip');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.skipped).toEqual([]);
    expect(read.file.rows[0]!.item).toMatchObject({ name: 'Swerve Module (multiple variants)', notes: expect.stringContaining('70 variants') });
    expect(read.file.rows[0]!.item.vendors[0]).toMatchObject({ partNo: '', packPriceCents: 1000 });
  });
});

describe('AndyMark catalog script: price and stock (Dan, 2026-11-16)', () => {
  const sale = { title: 'Sale Part', handle: 'sale-part', product_type: 'Spacers', tags: [], variants: [{ id: 1, title: 'Default Title', sku: 'am-9', price: '7.50', compare_at_price: '10.00', available: false }] };

  it('uses the current price, even when it is a sale price', () => {
    expect(productRows([sale], TODAY).rows[0]!.v1_pack_price).toBe('7.50');
  });

  it('keeps a part that is out of stock', () => {
    expect(exclusionReason(sale)).toBeNull();
    expect(productRows([sale], TODAY).rows).toHaveLength(1);
  });
});

describe('AndyMark catalog script: the opt-in photos (pilot)', () => {
  it('asks for the first image at a set width and names the file after the product', () => {
    const bushing = products[0];
    expect(imageFor(bushing)).toEqual({ url: `https://cdn.shopify.com/s/files/1/0000/0000/files/bushing.JPG?v=123&width=${IMAGE_WIDTH}`, file: 'photos/0875-in-id-1125-in-od-0750-in-long-bushing.jpg' });
    expect(imageFor(products[3])!.url).toBe(`https://cdn.shopify.com/s/files/1/0000/0000/files/wheel.png?width=${IMAGE_WIDTH}`);
    expect(imageFor(products[3])!.file).toBe('photos/example-wheel.png');
    expect(imageFor(products[1])).toBeNull();
    expect(imageFor({ handle: 'x', images: [{ src: 'http://insecure.example/a.jpg' }] })).toBeNull();
  });

  it('without images the rows have no photo columns at all', () => {
    expect(Object.keys(productRows(products, TODAY).rows[0]!)).not.toContain('photo_file');
  });

  it('with images the variants of a product share one photo, and rows without one are left blank', () => {
    const { rows } = productRows(products, TODAY, { images: true });
    const wheels = rows.filter((r) => r.name?.startsWith('Example Wheel'));
    expect(wheels.map((r) => r.photo_file)).toEqual(['photos/example-wheel.png', 'photos/example-wheel.png']);
    expect(rows.find((r) => r.name === 'Mystery Part')!.photo_file).toBe('');
  });

  it('the ZIP with photos is read by the importer, which stores the photo for the rows that have one', async () => {
    const { rows } = productRows(products, TODAY, { images: true });
    const photos = new Map([
      ['photos/0875-in-id-1125-in-od-0750-in-long-bushing.jpg', new Uint8Array([1, 2, 3])],
      ['photos/example-wheel.png', new Uint8Array([4, 5, 6])],
    ]);
    const read = await readAddFile(await buildCatalogZip(rows, photos), 'andymark.zip');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.skipped).toEqual([]);
    expect(read.file.missingPhotos).toEqual([]);
    expect([...read.file.photos.keys()].sort()).toEqual(['photos/0875-in-id-1125-in-od-0750-in-long-bushing.jpg', 'photos/example-wheel.png']);
    const plan = planAddItems(read.file, { items: [], suppliers: [], categories: [] });
    expect(plan.newItems.filter((n) => n.photoFile !== '')).toHaveLength(3);
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
