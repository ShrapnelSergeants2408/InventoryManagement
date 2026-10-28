// Barcode/QR detection for Scan (SPEC §2, F21). Chrome on Android has BarcodeDetector built
// in. Where it's missing (desktop Chrome on Windows, used while building), a zxing-based
// stand-in is loaded on demand, with its .wasm bundled in the app: the library's default is
// to fetch it from a CDN, which would break offline use.
import { SCAN_FORMATS } from '../domain/scan';

export interface Detected {
  rawValue: string;
  format: string;
  /** Where the code is in the frame, in video pixels; used to aim (scan-aim.ts). */
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface Detector {
  detect(source: ImageBitmapSource): Promise<Detected[]>;
  /** 'native' or 'zxing', for the About/diagnostics line and the browser check. */
  kind: 'native' | 'zxing';
}

interface DetectorClass {
  new (opts: { formats: string[] }): { detect(source: ImageBitmapSource): Promise<Detected[]> };
  getSupportedFormats(): Promise<string[]>;
}

let made: Promise<Detector> | null = null;

/** The detector for this browser, made once per session. */
export function getDetector(): Promise<Detector> {
  made ??= makeDetector().catch((e: unknown) => {
    made = null;
    throw e;
  });
  return made;
}

async function makeDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes('qr_code')) {
        const d = new Native({ formats });
        return { kind: 'native', detect: (s) => d.detect(s) };
      }
    } catch {
      // Fall through to the stand-in.
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  const d = new BarcodeDetector({ formats: [...SCAN_FORMATS] });
  return { kind: 'zxing', detect: (s) => d.detect(s as never) };
}
