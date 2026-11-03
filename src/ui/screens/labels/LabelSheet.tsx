// One letter page of QR labels (SPEC v3.0 §9), positioned in inches. The same component draws the
// on-screen preview (scaled) and the printed pages, so the preview is what prints. A label shows
// its face (domain/labels): a bin's code large, the name, a season chip, extra lines.
import { PAGE, type LabelBox, type LabelFace, type LabelLayout } from '../../../domain/labels';
import { qrMatrix, qrPath } from '../../../domain/qr';
import { qrPayload } from '../../../domain/scan';

const inch = (n: number) => `${n}in`;

export function QrSvg({ text, size }: { text: string; size: number }) {
  const { d, size: n } = qrPath(qrMatrix(text));
  return (
    <svg class="qr" viewBox={`0 0 ${n} ${n}`} width={inch(size)} height={inch(size)} shape-rendering="crispEdges" role="img" aria-label={`QR code ${text}`}>
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

function Label({ layout, box, face }: { layout: LabelLayout; box: LabelBox; face: LabelFace }) {
  return (
    <div
      class={`lab ${layout.flow}${layout.plain ? ' cut' : ''}`}
      data-slot={box.slot}
      data-id={face.id}
      style={{ left: inch(box.x), top: inch(box.y), width: inch(box.w), height: inch(box.h) }}
    >
      <QrSvg text={qrPayload(face.id)} size={layout.qr} />
      <div class="lab-t" style={{ fontSize: `${layout.textPt}pt` }}>
        {face.code && (
          <span class="lab-code" style={{ fontSize: `${Math.round(layout.textPt * (face.name ? 2.6 : 2.4))}pt` }}>
            {face.code}
          </span>
        )}
        {face.name && <span class="lab-n">{face.name}</span>}
        {face.chip && <span class="lab-chip">{face.chip.name}</span>}
        {face.extra.map((x, k) => (
          <span key={k} class="lab-x">
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A printed page: labels, or (test print) the outline and number of every label position. */
export function SheetPage(props: {
  layout: LabelLayout;
  labels: { box: LabelBox; face: LabelFace }[];
  /** Used labels at the start of the first sheet (preview only: shown hatched). */
  skipped?: LabelBox[];
  outlines?: LabelBox[];
  caption?: string;
}) {
  return (
    <div class="sheet" style={{ width: inch(PAGE.w), height: inch(PAGE.h) }}>
      {props.skipped?.map((b) => (
        <div key={`s${b.slot}`} class="lab used" style={{ left: inch(b.x), top: inch(b.y), width: inch(b.w), height: inch(b.h) }} />
      ))}
      {props.labels.map(({ box, face }) => (
        <Label key={box.slot} layout={props.layout} box={box} face={face} />
      ))}
      {props.outlines?.map((b) => (
        <div key={`o${b.slot}`} class="lab outline" data-slot={b.slot} style={{ left: inch(b.x), top: inch(b.y), width: inch(b.w), height: inch(b.h) }}>
          {b.slot + 1}
        </div>
      ))}
      {props.caption && <div class="sheet-cap">{props.caption}</div>}
    </div>
  );
}
