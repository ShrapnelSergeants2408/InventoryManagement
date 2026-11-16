import { describe, expect, it } from 'vitest';
import { COLLAPSE_OVER, buildCatalogZip, keywordCategory, packSizeFrom, robotsCrawlDelay, shopifyRows } from '../scripts/catalog-common.mjs';
import { VENDORS } from '../scripts/shopify-vendors.mjs';
import { SUPPLIER as REV, categoryFor, exclusionReason as revExclusion, parseOptions, parseProductPage, revImage, revRows, sitemapUrls } from '../scripts/rev-lib.mjs';
import { planAddItems, readAddFile } from '../src/io/add-items';

const TODAY = '2026-11-16';
const none = new Set<string>();
const product = (over: Record<string, unknown>) => ({ title: 'Part', handle: 'part', product_type: '', tags: [], options: [{ name: 'Title' }], images: [], variants: [{ id: 1, title: 'Default Title', sku: 'X-1', price: '5.00' }], ...over });
const keep = (v: keyof typeof VENDORS, over: Record<string, unknown>, include = none) => VENDORS[v]!.exclude(product(over), include);

describe('shared helpers (SPEC §23.7)', () => {
  it('reads the pack size from the title or the part number', () => {
    expect(packSizeFrom('QTY 4 - 2 Inch Solid Urethane Wheel - 60A durometer')).toBe(4);
    expect(packSizeFrom('QTY 10 FT - Black Polyurethane Flat Belt')).toBe(10);
    expect(packSizeFrom('QTY 1  - 10mm Carbide Endmill')).toBe(1);
    expect(packSizeFrom('2-pin to 3-pin Connector for SystemCore (8-Pack)')).toBe(8);
    expect(packSizeFrom('Locking Shaft Collar - MAXSpline - 2 Pack')).toBe(2);
    expect(packSizeFrom('Gusset', 'REV-41-1147-PK5')).toBe(5);
    expect(packSizeFrom('CAN Terminator Pack')).toBe(1);
    expect(packSizeFrom('2-pin Connector')).toBe(1);
    expect(packSizeFrom('Hex Spacers')).toBe(1);
  });

  it('places a name in the team categories by its words, first match wins', () => {
    expect(keywordCategory('WCP Aluminum Spur Gear (20 DP)')).toEqual({ category: 'Power Transfer', subcategory: 'Gears' });
    expect(keywordCategory('PlanetaryX Gearbox')).toEqual({ category: 'Power Transfer', subcategory: 'Gear Boxes' });
    expect(keywordCategory('Single Sided 9mm Wide HTD Timing Belts')).toEqual({ category: 'Power Transfer', subcategory: 'Belts' });
    expect(keywordCategory('Radial Bearing')).toEqual({ category: 'Mechanical', subcategory: 'Bearings' });
    expect(keywordCategory('10-32 Button Head Cap Screw')).toEqual({ category: 'Fasteners', subcategory: 'Screws' });
    expect(keywordCategory('Mystery Gizmo')).toBeNull();
  });

  it('reads a Crawl-delay for everyone', () => {
    expect(robotsCrawlDelay('User-agent: *\nCrawl-delay: 10\nDisallow: /wp-admin/\n')).toBe(10);
    expect(robotsCrawlDelay('User-agent: bingbot\nCrawl-delay: 30\n\nUser-agent: *\nDisallow:\n')).toBe(0);
  });
});

describe('Thrifty Bot (Dan, 2026-11-16: the same exclusions as AndyMark)', () => {
  it('leaves out bundles and kits, and what the title says is a tool', () => {
    expect(keep('thriftybot', { title: 'Squish Wheel Bundles' })).toBe('bundle or kit');
    expect(keep('thriftybot', { title: 'Thrifty Swerve Bolts Kit' })).toBe('bundle or kit');
    expect(keep('thriftybot', { title: 'QTY 2 - 4mm Carbide Single Flute Endmill' })).toBe('tool');
    expect(keep('thriftybot', { title: 'Thrifty Swerve Bolts Kit' }, new Set(['bundles']))).toBeNull();
  });

  it('leaves out merchandise, pre-orders, game items and FTC, but not a part that mentions a hat or Everybot', () => {
    expect(keep('thriftybot', { title: 'Thriftybot Green T-Shirt' })).toBe('merchandise');
    expect(keep('thriftybot', { title: 'The Thrifty Bot Gift Card' })).toBe('merchandise');
    expect(keep('thriftybot', { title: 'Sticker 2 Pack - School' })).toBe('merchandise');
    expect(keep('thriftybot', { title: 'Pre-Order: Thrifty Pulsar 775 Brushless Motor' })).toBe('game piece or pre-order');
    expect(keep('thriftybot', { title: '2026 REBUILT Official Hub Net' })).toBe('game piece or pre-order');
    expect(keep('thriftybot', { title: 'Molded 100mm Mecanum Wheels for FTC' })).toBe('ftc, fll or robits');
    expect(keep('thriftybot', { title: 'Thrifty Nova Sensor Hat' })).toBeNull();
    expect(keep('thriftybot', { title: 'QTY 4: 2023 Everybot Intake Side Plate' })).toBeNull();
  });

  it('keeps an assembly and an out-of-stock part, uses the current price, and sets the pack size from QTY', () => {
    const wheel = product({ title: 'QTY 4 - 2 Inch Solid Urethane Wheel - 60A durometer', handle: 'wheel', variants: [{ id: 1, title: 'Default Title', sku: 'TTB-0123', price: '25.00', compare_at_price: '30.00', available: false }] });
    const { rows } = shopifyRows([wheel, product({ title: 'Drive Plate Assembly', handle: 'dpa' })], TODAY, VENDORS.thriftybot!);
    expect(rows.map((r) => [r.name, r.v1_supplier, r.v1_pack_size, r.v1_pack_price])).toEqual([
      ['QTY 4 - 2 Inch Solid Urethane Wheel - 60A durometer', 'Thrifty Bot', '4', '25.00'],
      ['Drive Plate Assembly', 'Thrifty Bot', '1', '5.00'],
    ]);
    expect(rows[0]).toMatchObject({ category: 'Mechanical', subcategory: 'Wheels' });
    expect(rows[1]).toMatchObject({ category: 'Assemblies', subcategory: '' });
  });

  it('lists a part sold in several sizes once for each, and over 65 variants once in all', () => {
    const wheel = product({ title: 'Squish Wheel', handle: 'sw', variants: [{ id: 1, title: '3 in. / 30A', sku: 'A', price: '9' }, { id: 2, title: '4 in. / 60A', sku: 'B', price: '10' }] });
    expect(shopifyRows([wheel], TODAY, VENDORS.thriftybot!).rows.map((r) => r.name)).toEqual(['Squish Wheel - 3 in. / 30A', 'Squish Wheel - 4 in. / 60A']);
    const many = product({ title: 'Big Configurator', handle: 'big', variants: Array.from({ length: COLLAPSE_OVER + 1 }, (_, i) => ({ id: i + 1, title: `V${i}`, sku: `S${i}`, price: '3.00' })) });
    expect(shopifyRows([many], TODAY, VENDORS.thriftybot!).rows.map((r) => r.name)).toEqual(['Big Configurator (multiple variants)']);
  });
});

describe('CTRE (Dan, 2026-11-16: the same exclusions; WCP parts sold here are allowed)', () => {
  it('keeps WCP-branded parts', () => {
    expect(keep('ctre', { title: 'WCP Aluminum Spur Gear (20 DP)', vendor: 'WCP', variants: [{ id: 1, sku: 'WCP-0117', price: '12' }] })).toBeNull();
  });

  it('leaves out tools by tag or title, gift cards, discontinued, bundles and kits', () => {
    expect(keep('ctre', { title: 'WCP #25 Chain Breaker Replacement Pin Set', tags: ['tool'] })).toBe('tool');
    expect(keep('ctre', { title: 'Non-insulated Terminal Crimp Tool by IWISS' })).toBe('tool');
    expect(keep('ctre', { title: 'CTR Electronics Gift Cards' })).toBe('merchandise');
    expect(keep('ctre', { title: 'Voltage Regulator Module- Discontinued' })).toBe('discontinued');
    expect(keep('ctre', { title: 'FIM Swerve X2i Discounted Bundle' })).toBe('bundle or kit');
    expect(keep('ctre', { title: 'CAN Bus & Power Cable Kit' })).toBe('bundle or kit');
  });

  it('leaves out software and Phoenix licences, but not a game-piece-control wheel or a digital sensor', () => {
    expect(keep('ctre', { title: 'Phoenix Pro- Advanced Robotics & Automation Software' })).toBe('software or license');
    expect(keep('ctre', { title: 'Phoenix Season Pass', variants: [{ id: 1, sku: 'LIC-1-2-FRC', price: '99' }] })).toBe('software or license');
    expect(keep('ctre', { title: 'WCP Plastic Vector Intake Wheels – Game Piece Control for Robotics' })).toBeNull();
    expect(keep('ctre', { title: 'CANdi®- Digital Sensors to CAN Converter', tags: ['digital', '2024-new-product'] })).toBeNull();
  });

  it('keeps an unavailable product, and reads "(2-pack)" as a pack of 2', () => {
    const plate = product({ title: '1.125" Bore Bearing Roller Center Plate (2-pack)', handle: 'plate', tags: ['unavailable'], variants: [{ id: 1, sku: 'WCP-0476', price: '8.99', available: false }] });
    const { rows } = shopifyRows([plate], TODAY, VENDORS.ctre!);
    expect(rows[0]).toMatchObject({ v1_supplier: 'CTRE', v1_part_no: 'WCP-0476', v1_pack_size: '2', v1_pack_price: '8.99' });
  });
});

// REV page markup as seen on 2026-11-16: JSON-LD in script blocks, options in the add-to-cart form.
const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const crumbs = (...names: string[]) => ld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: ['Home', ...names].map((name, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@id': `https://www.revrobotics.com/c${i}/`, name } })) });
const prod = (over: Record<string, unknown>) => ld({ '@context': 'https://schema.org/', '@type': 'Product', name: 'Vortex Shaft - 8mm', sku: 'REV-21-2807', image: 'https://cdn11.bigcommerce.com/s-x/images/stencil/1500x1500/products/809/3204/shaft.png?c=2', offers: { '@type': 'Offer', priceCurrency: 'USD', price: '11', availability: 'https://schema.org/InStock' }, ...over });
const radios = (name: string, labels: string[]) =>
  `<div class="form-field" data-product-attribute="set-radio"><label class="form-label form-label--alternate form-label--inlineSmall"> ${name}: <small class="_required" title="Required">*</small> </label>${labels
    .map((l, i) => `<input class="form-radio" type="radio" id="a_${i}" name="attribute[532]" value="${i}" required> <label data-product-attribute-value="${i}" class="form-label" for="a_${i}">${l}</label>`)
    .join('')}</div><div class="productView-qtyAddWrapper"></div>`;
const page = (parts: string[]) => `<html><body>${parts.join('\n')}</body></html>`;

describe('REV Robotics page parser', () => {
  it('reads the product, price, photo and REV’s own category path from the JSON-LD', () => {
    const p = parseProductPage(page([crumbs('REV ION', 'Brushless', 'NEO Vortex &amp; SPARK Flex', 'Vortex Shaft - 8mm'), prod({})]));
    expect(p).toMatchObject({ name: 'Vortex Shaft - 8mm', sku: 'REV-21-2807', price: '11.00', availability: 'InStock', crumbs: ['Home', 'REV ION', 'Brushless', 'NEO Vortex & SPARK Flex', 'Vortex Shaft - 8mm'], options: [] });
    expect(parseProductPage(page(['<p>no data</p>']))).toBeNull();
  });

  it('a numeric product id is not a part number, and a text price with a symbol is read', () => {
    const p = parseProductPage(page([prod({ sku: '977', offers: { price: '$9.75', availability: 'https://schema.org/OutOfStock' } })]));
    expect(p).toMatchObject({ sku: '', price: '9.75', availability: 'OutOfStock' });
  });

  it('reads option choices with the part number in each label, and ignores "Please choose"', () => {
    const html = radios('Type', ['Shaft Collars - 10 Pack (REV-41-1327-PK10)', 'Slim Shaft Collar - 10 Pack (REV-41-1629-PK10)', 'Plain choice']);
    expect(parseOptions(html)).toEqual([
      { name: 'Type', values: [{ label: 'Shaft Collars - 10 Pack', sku: 'REV-41-1327-PK10' }, { label: 'Slim Shaft Collar - 10 Pack', sku: 'REV-41-1629-PK10' }, { label: 'Plain choice', sku: '' }] },
    ]);
    const select = '<div class="form-field" data-product-attribute="set-select"><label class="form-label">Length:</label><select><option value="">Please choose</option><option value="12">4 in.</option><option value="13">8 in.</option></select></div><div class="productView-qtyAddWrapper"></div>';
    expect(parseOptions(select)[0]).toMatchObject({ name: 'Length', values: [{ label: '4 in.' }, { label: '8 in.' }] });
  });

  it('asks for the photo at 1024 px and names it after the page', () => {
    const p = parseProductPage(page([prod({})]))!;
    expect(revImage(p, 'https://www.revrobotics.com/rev-21-2807/')).toEqual({ url: 'https://cdn11.bigcommerce.com/s-x/images/stencil/1024x1024/products/809/3204/shaft.png?c=2', file: 'photos/rev-21-2807.png' });
  });

  it('reads the product addresses in a sitemap', () => {
    expect(sitemapUrls('<urlset><url><loc>https://www.revrobotics.com/a/</loc></url><url><loc>https://www.revrobotics.com/b/</loc></url></urlset>')).toEqual(['https://www.revrobotics.com/a/', 'https://www.revrobotics.com/b/']);
  });
});

describe('REV Robotics rules and rows (Dan, 2026-11-16: the same exclusions; vendor categories where possible)', () => {
  const pg = (name: string, path: string[], over: Record<string, unknown> = {}, options = '') => parseProductPage(page([crumbs(...path, name), prod({ name, ...over }), options]))!;

  it('leaves out discontinued, FTC, bundles, kits, merchandise and tools — but "Hardware & Tools" is where fasteners live', () => {
    expect(revExclusion(pg('Through Bore Encoder V1', ['Shop All', 'Discontinued & Discounted Products']))).toBe('discontinued');
    expect(revExclusion(pg('15mm Plastic Motion Brackets', ['Competition', 'FIRST Tech Challenge', 'REV DUO FTC Starter Kit']))).toBe('ftc, fll or robits');
    expect(revExclusion(pg('15mm Linear Motion Kit V2', ['REV DUO', 'Kits & Bundles']))).toBe('bundle');
    expect(revExclusion(pg('DUO Control Bundle', ['Education']))).toBe('bundle or kit');
    expect(revExclusion(pg('REV T-Shirt', ['Merchandise']))).toBe('merchandise');
    expect(revExclusion(pg('Hex Key Set', ['Hardware & Tools', 'Tools']))).toBe('tool');
    expect(revExclusion(pg('#10-32 Screws', ['REV ION', 'Hardware & Tools', 'Fasteners']))).toBeNull();
    expect(revExclusion(pg('Vortex Shaft - 8mm', ['REV ION', 'Brushless']))).toBeNull();
  });

  it('keeps an FTC-path part that is also an FRC (REV ION) product, and an out-of-stock part', () => {
    expect(revExclusion(pg('Both', ['Competition', 'FIRST Tech Challenge', 'REV ION', 'Fasteners']))).toBeNull();
    const out = pg('SPARK Lite', ['Competition'], { sku: 'REV-11-3350', offers: { price: '60', availability: 'https://schema.org/OutOfStock' } });
    expect(revRows([{ url: 'https://www.revrobotics.com/rev-11-3350/', page: out }], TODAY).rows).toHaveLength(1);
  });

  it('puts a part in a team category by its name, else under Misc with REV’s own category', () => {
    expect(categoryFor(pg('NEO Vortex Brushless Motor', ['REV ION', 'Brushless']))).toMatchObject({ category: 'Electrical', subcategory: 'Motors', mapped: true });
    expect(categoryFor(pg('Mystery Thing', ['Shop All', 'REV ION', 'Starter Bot', 'Conveyor']))).toMatchObject({ category: 'Misc', subcategory: 'Starter Bot › Conveyor', mapped: false });
    // REV's own path is used for the words too: "NEO Vortex & SPARK Flex" says electrical.
    expect(categoryFor(pg('Mystery Thing', ['REV ION', 'Brushless', 'NEO Vortex & SPARK Flex']))).toMatchObject({ category: 'Electrical', mapped: true });
    expect(categoryFor(pg('Climber in a Box', ['Competition']))).toMatchObject({ category: 'Assemblies' });
  });

  it('a plain page is one row with a pack size from "- 5 Pack" or -PK5', () => {
    const p = pg('#35 Connecting Links - 5 Pack', ['Competition'], { sku: 'REV-21-3744-PK5' });
    expect(revRows([{ url: 'https://www.revrobotics.com/rev-21-3744-pk5/', page: p }], TODAY).rows[0]).toMatchObject({
      name: '#35 Connecting Links - 5 Pack',
      v1_supplier: 'REV',
      v1_part_no: 'REV-21-3744-PK5',
      v1_pack_size: '5',
      v1_pack_price: '11.00',
      v1_url: 'https://www.revrobotics.com/rev-21-3744-pk5/',
      category: 'Power Transfer',
      subcategory: 'Chains',
    });
  });

  it('a page with one option group is a row per choice, with the part number from each label', () => {
    const p = pg('Shaft Collars', ['REV ION'], { sku: '977' }, radios('Type', ['Shaft Collars - 10 Pack (REV-41-1327-PK10)', 'Slim Shaft Collar - 10 Pack (REV-41-1629-PK10)']));
    const { rows } = revRows([{ url: 'https://www.revrobotics.com/shaft-collars', page: p }], TODAY);
    expect(rows.map((r) => [r.name, r.v1_part_no, r.v1_pack_size])).toEqual([
      ['Shaft Collars - Shaft Collars - 10 Pack', 'REV-41-1327-PK10', '10'],
      ['Shaft Collars - Slim Shaft Collar - 10 Pack', 'REV-41-1629-PK10', '10'],
    ]);
    expect(rows[0]!.notes).toContain('the option may change it');
  });

  it('a single choice is a plain row, and two groups are one "(multiple variants)" row', () => {
    const one = pg('Screws', ['REV ION'], { sku: '898' }, radios('Size', ['100 Pack (REV-29-1223-PK100)']));
    expect(revRows([{ url: 'https://www.revrobotics.com/s', page: one }], TODAY).rows.map((r) => [r.name, r.v1_part_no, r.v1_pack_size])).toEqual([['Screws', 'REV-29-1223-PK100', '100']]);
    const two = pg('Traction Wheels', ['REV ION'], { sku: '666' }, radios('Size', ['2 in.', '3 in.']) + radios('Color', ['Red', 'Blue', 'Green']));
    const { rows } = revRows([{ url: 'https://www.revrobotics.com/w', page: two }], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Traction Wheels (multiple variants)', v1_part_no: '' });
    expect(rows[0]!.notes).toBe("6 combinations of Size (2), Color (3); choose on the product page. The price is the page's; options may change it.");
  });

  it('leaves each product it drops in the left-out list with its reason', () => {
    const list = [pg('Good Part', ['REV ION']), pg('Old', ['Discontinued & Discounted Products']), pg('A Bundle', ['Kits & Bundles'])].map((page, i) => ({ url: `https://www.revrobotics.com/${i}/`, page }));
    const { rows, skipped } = revRows(list, TODAY);
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([{ title: 'Old', reason: 'discontinued' }, { title: 'A Bundle', reason: 'bundle' }]);
  });
});

describe('each vendor’s ZIP is read by Add items from a file (SPEC §23.7)', () => {
  it('Thrifty Bot and CTRE', async () => {
    for (const key of ['thriftybot', 'ctre'] as const) {
      const v = VENDORS[key]!;
      const { rows } = shopifyRows([product({ title: 'Radial Bearing (2-pack)', handle: 'b', images: [{ src: 'https://cdn.shopify.com/a.jpg' }] }), product({ title: 'Hex Spacers', handle: 's', variants: [{ id: 1, title: '1 in.', sku: 'S1', price: '1' }, { id: 2, title: '2 in.', sku: 'S2', price: '2' }] })], TODAY, v, { images: true });
      const photos = new Map([['photos/b.jpg', new Uint8Array([1, 2, 3])]]);
      for (const r of rows) if (r.photo_file !== 'photos/b.jpg') r.photo_file = '';
      const read = await readAddFile(await buildCatalogZip(rows, photos, v.supplier), `${key}.zip`);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.file.skipped).toEqual([]);
      expect(read.file.missingPhotos).toEqual([]);
      const plan = planAddItems(read.file, { items: [], suppliers: [], categories: [] });
      expect(plan.newItems).toHaveLength(3);
      expect(plan.newSuppliers.map((s) => s.name)).toEqual([v.supplier.name]);
      expect(plan.newItems.find((n) => n.item.name.startsWith('Radial'))!.item.vendors[0]).toMatchObject({ packSize: 2 });
    }
  });

  it('REV, with a photo', async () => {
    const p = parseProductPage(page([crumbs('REV ION', 'Vortex Shaft - 8mm'), prod({})]))!;
    const { rows } = revRows([{ url: 'https://www.revrobotics.com/rev-21-2807/', page: p }], TODAY, { images: true });
    const read = await readAddFile(await buildCatalogZip(rows, new Map([[rows[0]!.photo_file!, new Uint8Array([9, 9])]]), REV), 'rev.zip');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.skipped).toEqual([]);
    expect(read.file.photos.size).toBe(1);
    expect(read.file.rows[0]!.item.vendors[0]).toMatchObject({ supplier: 'REV', partNo: 'REV-21-2807', packPriceCents: 1100 });
  });
});
