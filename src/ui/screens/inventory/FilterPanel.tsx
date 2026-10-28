// Filters panel (F5): side sheet in landscape, bottom sheet in portrait. The location can
// also be set by scanning a bin's QR code (F29).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Filters } from '../../../domain/filters';
import { NO_LOCATION } from '../../../domain/lists';
import type { FilterOptions, Totals } from '../../../domain/inventory-view';
import { nameKey, type Location } from '../../../domain/types';
import { LocationScanDialog } from '../../components/LocationScanDialog';
import { Icon } from '../../icons';
import { showToast } from '../../shell/toast';

export const NO_LOCATION_LABEL = NO_LOCATION;

function Choice(props: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" class={props.on ? 'fchip on' : 'fchip'} aria-pressed={props.on} onClick={props.onClick}>
      {props.label}
    </button>
  );
}

export function FilterPanel(props: {
  filters: Filters;
  options: FilterOptions;
  /** Every location, so a scanned name in the list but with no items can say so. */
  locations: readonly Location[];
  totals: Totals;
  shown: number;
  onChange: (f: Filters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { filters: f, onChange } = props;
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const pick = <K extends 'category' | 'supplier' | 'location'>(k: K, v: string) => onChange({ ...f, [k]: f[k] === v ? null : v });

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="fpanel" role="dialog" aria-modal="true" aria-label="Filters">
        <div class="fpanel-head">
          <h2 class="h2">Filters</h2>
          <button ref={closeBtn} type="button" class="ib" aria-label="Close filters" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div class="fpanel-body">
          <section class="fsec">
            <h3>Stock</h3>
            <div class="fgrid">
              <Choice on={f.needsOrder} label={`Needs order · ${props.totals.needsOrder}`} onClick={() => onChange({ ...f, needsOrder: !f.needsOrder })} />
              <Choice on={f.short} label={`Short · ${props.totals.short}`} onClick={() => onChange({ ...f, short: !f.short })} />
              <Choice on={f.low} label={`Low spares · ${props.totals.low}`} onClick={() => onChange({ ...f, low: !f.low })} />
            </div>
          </section>
          <section class="fsec">
            <h3>Category</h3>
            <div class="fgrid">
              {props.options.categories.map((c) => (
                <Choice key={c} on={f.category === c} label={c} onClick={() => pick('category', c)} />
              ))}
            </div>
          </section>
          <section class="fsec">
            <div class="fsec-h">
              <h3>Location</h3>
              <button type="button" class="btn sm" onClick={() => setScanning(true)}>
                <Icon name="scan" />
                Scan a location
              </button>
            </div>
            <div class="fgrid">
              {props.options.locations.map((l) => (
                <Choice key={l} on={f.location === l} label={l || NO_LOCATION_LABEL} onClick={() => pick('location', l)} />
              ))}
            </div>
          </section>
          {/* Supplier last (F5, SPEC v0.8). */}
          <section class="fsec">
            <h3>Preferred supplier</h3>
            <div class="fgrid">
              {props.options.suppliers.map((s) => (
                <Choice key={s} on={f.supplier === s} label={s} onClick={() => pick('supplier', s)} />
              ))}
            </div>
          </section>
        </div>
        <div class="fpanel-foot">
          <button type="button" class="btn" onClick={props.onClear}>
            Clear all
          </button>
          <button type="button" class="btn pri grow" onClick={props.onClose}>
            Show {props.shown} {props.shown === 1 ? 'item' : 'items'}
          </button>
        </div>
      </div>
      {scanning && (
        <LocationScanDialog
          locations={props.locations}
          notFound="report"
          title="Filter by a location"
          onClose={() => setScanning(false)}
          onPicked={(l) => {
            setScanning(false);
            const name = props.options.locations.find((o) => o !== '' && nameKey(o) === nameKey(l.name));
            if (name === undefined) showToast(`No items are in ${l.name} yet.`);
            else onChange({ ...f, location: name });
          }}
        />
      )}
    </>
  );
}
