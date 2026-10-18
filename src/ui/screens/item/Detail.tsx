// Item detail card (F10): photo (tap to enlarge), +/− for on hand, desired and spares,
// the order line, location/category/barcode/notes, every vendor option with its link (F11).
import { useState } from 'preact/hooks';
import { adjustCount, setCount, type CountField } from '../../../data/inventory';
import { formatIsoDate } from '../../../domain/dates';
import { orderLines, packText, stockLines } from '../../../domain/item-text';
import { formatCents } from '../../../domain/money';
import { stockStatus } from '../../../domain/status';
import type { Item } from '../../../domain/types';
import { safeHref } from '../../../domain/url';
import { BackButton, StateMessage, StatusChip, TopBar, plural } from '../../components/common';
import { CountStepper, type StepperLabel } from '../../components/OnHandStepper';
import { useDb, usePhotoUrl, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { DeleteItemButton } from './DeleteItem';

const crumb = (i: Item) => (i.subcategory ? `${i.category} › ${i.subcategory}` : i.category);

export function DetailScreen({ id }: { id: string }) {
  const live = useSnapshot();
  const back = <BackButton fallback={href.tab('inventory')} />;
  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Item" back={back} />
        <StorageError error={live.error} />
      </>
    );
  }
  if (live.state === 'loading') {
    return (
      <>
        <TopBar title="Loading…" kicker="" back={back} />
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading item…</p>
        </div>
      </>
    );
  }
  const item = live.value.items.find((i) => i.id === id);
  if (!item) return <ItemMissing id={id} back={back} />;
  return <Detail item={item} back={back} />;
}

export function ItemMissing({ id, back }: { id: string; back: preact.ComponentChildren }) {
  return (
    <>
      <TopBar title="Item not found" back={back} />
      <StateMessage
        icon="search"
        title={`No item “${id}” on this tablet`}
        actions={
          <a class="btn pri" href={href.tab('inventory')}>
            <Icon name="inventory" />
            Go to the inventory
          </a>
        }
      >
        <p class="state-text">It may have been deleted, or this tablet was restored from an older backup.</p>
      </StateMessage>
    </>
  );
}

function Detail({ item, back }: { item: Item; back: preact.ComponentChildren }) {
  const db = useDb();
  const photo = usePhotoUrl(item.id, item.hasPhoto);
  const [enlarged, setEnlarged] = useState(false);
  const status = stockStatus(item.onHand, item.desired, item.spares);
  const stock = stockLines(item);
  const order = orderLines(item);
  const vendors = item.vendors.flatMap((v, i) => (v ? [{ v, slot: i + 1 }] : []));

  const fail = (e: unknown) => showToast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
  const stepper = (field: CountField, label: StepperLabel, size?: 'xl') => (
    <CountStepper
      label={label}
      value={item[field]}
      itemName={item.name}
      size={size}
      onStep={(d) => void adjustCount(db, item.id, field, d).catch(fail)}
      onSet={(n) =>
        setCount(db, item.id, field, n).catch((e: unknown) => {
          fail(e);
          throw e;
        })
      }
    />
  );

  return (
    <>
      <TopBar title={item.name} kicker={crumb(item)} back={back} />
      <div class="dbody">
        <div class="dleft">
          <div class="dphoto">
            {item.hasPhoto && photo ? (
              <button type="button" class="photo" onClick={() => setEnlarged(true)} aria-label="Enlarge photo">
                <img src={photo} alt={item.name} />
                <span class="hint">Tap to enlarge</span>
              </button>
            ) : (
              <div class="photo nophoto">
                <Icon name="photo" class="ic xxl" />
                <span class="nophoto-t">{item.hasPhoto ? 'Loading photo…' : 'No photo yet'}</span>
              </div>
            )}
            {item.hasPhoto && item.source === 'starter' && (
              <span class="small muted">Vendor product photo from the starter catalog. Replace it with a photo of your own part any time.</span>
            )}
          </div>
          <div class="dacts">
            <a class="btn pri lg" href={href.edit(item.id)}>
              <Icon name="pencil" />
              Edit item
            </a>
            <DeleteItemButton item={item} />
          </div>
        </div>

        <div class="dright">
          <div class="dchips">
            <span class="bigchip">
              <StatusChip status={status} />
            </span>
            <span class="chip mut">{item.source === 'starter' ? 'Starter item' : 'Team item'}</span>
            <span class="chip mut">ID {item.id}</span>
            <span class="chip mut">{item.lastCounted ? `Counted ${formatIsoDate(item.lastCounted)}` : 'Not counted yet'}</span>
          </div>

          <div class="card box">
            <span class="lbl">On hand ({item.unit})</span>
            <div class="qty">
              {stepper('onHand', 'On hand', 'xl')}
              <div class="qty-text">
                <div class="qty-title">{stock.title}</div>
                <div class="small muted">{stock.sub}</div>
              </div>
            </div>
          </div>

          <div class="two">
            <div class="card box">
              <span class="lbl">Desired</span>
              {stepper('desired', 'Desired')}
            </div>
            <div class="card box">
              <span class="lbl">Spares</span>
              {stepper('spares', 'Spares')}
            </div>
          </div>

          <div class="card box ordbox">
            <Icon name="order" class="ic lg" />
            <div>
              <div class="qty-title">{order.title}</div>
              <div class="small muted">{order.sub}</div>
            </div>
          </div>

          <div class="card box kv">
            <span class="lbl">Location</span>
            <span class={item.location ? '' : 'noloc'}>{item.location || 'No location'}</span>
            <span class="lbl">Category</span>
            <span>{crumb(item)}</span>
            <span class="lbl">Barcode</span>
            <span class={item.barcode ? 'mono' : 'muted'}>{item.barcode || 'None'}</span>
            <span class="lbl">Notes</span>
            <span class={item.notes ? 'notes' : 'muted'}>{item.notes || 'No notes'}</span>
          </div>

          <section>
            <h2 class="h2 sec-h">Where to buy ({plural(vendors.length, 'vendor option')})</h2>
            <div class="vends">
              {vendors.map(({ v, slot }) => {
                const link = safeHref(v.url);
                return (
                  <div class="card vend" key={slot}>
                    <div class="vtext">
                      <div class="vname">
                        {v.supplier}
                        {slot === item.preferredVendor && (
                          <span class="chip pref">
                            <Icon name="star" />
                            Preferred
                          </span>
                        )}
                      </div>
                      <div>
                        <span class="mono">{v.partNo || 'No part #'}</span> · {packText(v)} ·{' '}
                        <strong>{v.packPriceCents === null ? 'No price' : `${formatCents(v.packPriceCents)}${v.packSize > 1 ? ' per pack' : ''}`}</strong>
                      </div>
                      <div class="small muted">{v.priceChecked ? `Price checked ${formatIsoDate(v.priceChecked)}` : 'Price date unknown'}</div>
                    </div>
                    {link ? (
                      <a class="btn" href={link} target="_blank" rel="noopener noreferrer">
                        Open product page
                        <Icon name="external" />
                      </a>
                    ) : (
                      <span class="small muted">No product link</span>
                    )}
                  </div>
                );
              })}
            </div>
            <p class="small muted lockline">
              <Icon name="lock" />
              Changing vendors, prices or the preferred vendor needs the mentor PIN (Edit item).
            </p>
          </section>
        </div>
      </div>

      {enlarged && photo && (
        <div class="lb" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setEnlarged(false)}>
          <img src={photo} alt={item.name} />
          <div class="lb-cap">{item.name}</div>
          <button type="button" class="btn pri lg" autoFocus onClick={() => setEnlarged(false)}>
            <Icon name="close" />
            Close
          </button>
        </div>
      )}
    </>
  );
}
