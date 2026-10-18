// QR codes for labels (SPEC §9), drawn as one SVG path so they print sharp at any size.
import qrcode from 'qrcode-generator';

/** Light modules kept around the code. Labels add their own white padding on top. */
export const QR_QUIET_MODULES = 2;

/** The QR matrix for `text`: true = dark. Error correction M survives a scuffed label. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * An SVG path of the dark modules with a quiet zone, in module units: use it with
 * viewBox="0 0 size size". Each row's runs of dark modules become one rectangle.
 */
export function qrPath(matrix: boolean[][], quiet = QR_QUIET_MODULES): { d: string; size: number } {
  const n = matrix.length;
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    const row = matrix[r]!;
    for (let c = 0; c < n; ) {
      if (!row[c]) {
        c++;
        continue;
      }
      let end = c;
      while (end < n && row[end]) end++;
      parts.push(`M${c + quiet} ${r + quiet}h${end - c}v1h${c - end}z`);
      c = end;
    }
  }
  return { d: parts.join(''), size: n + 2 * quiet };
}
