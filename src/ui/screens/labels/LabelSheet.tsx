// One letter page of QR labels (SPEC §9), positioned in inches. The same component draws the
// on-screen preview (scaled) and the printed pages, so the preview is what prints.
import { labelText, PAGE, type LabelBox, type LabelLayout } from '../../../domain/labels';
import { qrMatrix, qrPath } from '../../../domain/qr';
import { qrPayload } from '../../../domain/scan';
import type { Item } from '../../../domain/types';

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

function Label({ layout, box, item }: { layout: LabelLayout; box: LabelBox; item: Item }) {
  const t = labelText(item, layout.content);
  return (
    <div
      class={`lab ${layout.flow}${layout.plain ? ' cut' : ''}`}
      data-slot={box.slot}
      data-id={item.id}
      style={{ left: inch(box.x), top: inch(box.y), width: inch(box.w), height: inch(box.h) }}
    >
      <QrSvg text={qrPayload(item.id)} size={layout.qr} />
      <div class="lab-t" style={{ fontSize: `${layout.textPt}pt` }}>
        <span class="lab-n">{t.name}</span>
        {t.extra.map((x) => (
          <span key={x} class="lab-x">
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
  labels: { box: LabelBox; item: Item }[];
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
      {props.labels.map(({ box, item }) => (
        <Label key={box.slot} layout={props.layout} box={box} item={item} />
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
