import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { qrMatrix, qrPath } from '../src/domain/qr';
import { QR_PREFIX, barcodeKey, cleanCode, formatName, qrPayload, resolveScan } from '../src/domain/scan';
import { area, bin, item, spot } from './helpers';

const items = [
  item({ id: 'st-0063', name: 'NEO 2.0', barcode: '' }),
  item({ id: 'st-0050', name: 'SPARK MAX', barcode: '722787604386' }),
  item({ id: 'tm-7K3QX', name: 'Team bracket', barcode: 'ABC-123' }),
  item({ id: 'tm-AAAAA', name: 'Twin 1', barcode: '0012345678905' }),
  item({ id: 'tm-BBBBB', name: 'Twin 2', barcode: '012345678905' }),
];
// Both parts: a Holiday bin and a Household bin and spot (letters and codes are unique across parts).
const places = {
  areas: [area({ id: 'ar-store', part: 'holiday', letter: 'S' }), area({ id: 'ar-garage', part: 'household', name: 'Garage', letter: 'G' })],
  spots: [spot({ id: 'sp-rack1', areaId: 'ar-store', name: 'Rack 1' }), spot({ id: 'sp-peg', areaId: 'ar-garage', name: 'Pegboard' })],
  bins: [bin({ id: 'bn-S2', code: 'S-02', part: 'holiday', spotId: 'sp-rack1' }), bin({ id: 'bn-G3', code: 'G-03', part: 'household', name: 'Cords', spotId: 'sp-peg' })],
};
const data = { items, bins: places.bins, spots: places.spots };
const kind = (raw: string) => {
  const r = resolveScan(raw, data);
  if (r.kind === 'item') return [r.kind, r.item.id, r.via];
  if (r.kind === 'bin') return [r.kind, r.bin.id, r.via];
  if (r.kind === 'spot') return [r.kind, r.spot.id, r.via];
  return r.kind === 'many' ? [r.kind, r.items.map((i) => i.id)] : r.kind === 'missing-label' ? [r.kind, r.id] : [r.kind];
};

describe('QR payload (SPEC §9)', () => {
  it('is hhi:<id>', () => {
    expect(qrPayload('st-0063')).toBe('hhi:st-0063');
    expect(QR_PREFIX).toBe('hhi:');
  });
});

describe('scan resolution (SPEC v3.0 F3)', () => {
  it('bin and spot labels open them, in either part', () => {
    expect(kind('hhi:bn-S2')).toEqual(['bin', 'bn-S2', 'label']);
    expect(kind('hhi:bn-G3')).toEqual(['bin', 'bn-G3', 'label']);
    expect(kind('hhi:sp-rack1')).toEqual(['spot', 'sp-rack1', 'label']);
    expect(kind('sp-peg')).toEqual(['spot', 'sp-peg', 'id']);
  });

  it('a typed bin code finds the bin wherever it is: "S-02", "s2", "g 3"', () => {
    expect(kind('S-02')).toEqual(['bin', 'bn-S2', 'code']);
    expect(kind('s2')).toEqual(['bin', 'bn-S2', 'code']);
    expect(kind('g 3')).toEqual(['bin', 'bn-G3', 'code']);
    expect(kind('Z-99')).toEqual(['unknown']);
  });

  it('a label for a bin or spot no longer here', () => {
    expect(kind('hhi:bn-GONE')).toEqual(['missing-label', 'bn-GONE']);
  });

  it('a team label opens its item', () => {
    expect(kind('hhi:st-0063')).toEqual(['item', 'st-0063', 'label']);
  });

  it('case and whitespace around a label or typed id are ignored', () => {
    expect(kind('  HHI:ST-0063 \n')).toEqual(['item', 'st-0063', 'label']);
    expect(kind('tm-7k3qx')).toEqual(['item', 'tm-7K3QX', 'id']);
    expect(kind(' st-0063 ')).toEqual(['item', 'st-0063', 'id']);
  });

  it('a stored manufacturer barcode opens its item, also when typed in groups', () => {
    expect(kind('722787604386')).toEqual(['item', 'st-0050', 'barcode']);
    expect(kind('7 22787 60438 6')).toEqual(['item', 'st-0050', 'barcode']);
    expect(kind('abc-123')).toEqual(['item', 'tm-7K3QX', 'barcode']);
  });

  it('EAN-13 with a leading 0 matches the same UPC-A', () => {
    expect(kind('0722787604386')).toEqual(['item', 'st-0050', 'barcode']);
    expect(barcodeKey('0722787604386')).toBe(barcodeKey('722787604386'));
    expect(barcodeKey('1722787604386')).not.toBe(barcodeKey('722787604386'));
  });

  it('the same barcode on two items: both offered', () => {
    expect(kind('012345678905')).toEqual(['many', ['tm-AAAAA', 'tm-BBBBB']]);
  });

  it('a household label for an item not on this phone', () => {
    expect(kind('hhi:st-9999')).toEqual(['missing-label', 'st-9999']);
  });

  it('anything else is unknown (attach or add); blank is empty', () => {
    expect(kind('5012345678900')).toEqual(['unknown']);
    expect(kind('https://www.revrobotics.com/rev-21-1650/')).toEqual(['unknown']);
    expect(kind('   ')).toEqual(['empty']);
    expect(resolveScan(' 0 1234 ', data)).toEqual({ kind: 'unknown', code: '01234' });
  });

  it('an item with no barcode is never matched by a blank one', () => {
    expect(resolveScan('', data).kind).toBe('empty');
  });

  it('cleanCode and formatName', () => {
    expect(cleanCode(' 7 22 \t8 ')).toBe('7228');
    expect([formatName('upc_a'), formatName('qr_code'), formatName(null), formatName('weird')]).toEqual(['UPC-A barcode', 'QR code', 'Typed code', 'Code']);
  });
});

describe('QR round trip: generated label codes decode back to the payload', () => {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm'));
  prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer } });

  /** Renders the matrix (with its quiet zone) to RGBA pixels, `scale` px per module. */
  function render(text: string, scale = 4) {
    const m = qrMatrix(text);
    const { size } = qrPath(m);
    const quiet = (size - m.length) / 2;
    const px = size * scale;
    const data = new Uint8ClampedArray(px * px * 4).fill(255);
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) {
        const r = Math.floor(y / scale) - quiet;
        const c = Math.floor(x / scale) - quiet;
        if (m[r]?.[c]) data.fill(0, (y * px + x) * 4, (y * px + x) * 4 + 3);
      }
    return { data, width: px, height: px, colorSpace: 'srgb' as const };
  }

  it.each(['hhi:st-0063', 'hhi:st-0001', 'hhi:tm-7K3QX', 'hhi:tm-ZZZZZ'])('%s', async (text) => {
    const found = await readBarcodes(render(text) as unknown as ImageData, { formats: ['QRCode'] });
    expect(found.map((f) => f.text)).toEqual([text]);
    expect(found[0]!.ecLevel).toBe('M'); // survives a scuffed label
    expect(resolveScan(found[0]!.text, data).kind).not.toBe('unknown');
  });

  it('the path draws exactly the dark modules', () => {
    const m = qrMatrix('hhi:st-0063');
    const dark = m.flat().filter(Boolean).length;
    const area = [...qrPath(m).d.matchAll(/h(\d+)/g)].reduce((s, x) => s + Number(x[1]), 0);
    expect(area).toBe(dark);
    expect(m.length).toBe(21); // version 1: large modules on a small label
    expect(qrPath(m).size).toBe(25);
  });
});
