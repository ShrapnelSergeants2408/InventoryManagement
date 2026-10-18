// More (§17, mockup 9a): Suppliers, Categories, Locations, Backup; the mentor PIN and
// settings (M6) are listed as coming later.
import { TopBar, plural } from '../../components/common';
import { daysSinceBackup } from '../../../domain/backup-reminder';
import { formatBytes } from '../../../domain/dates';
import { useNow, useSettings, useSnapshot, useStorageStatus } from '../../data-hooks';
import { Icon, type IconName } from '../../icons';
import { href } from '../../shell/router';

function Row(props: { icon: IconName; title: string; sub: string; chip?: string; to?: string; later?: string }) {
  const body = (
    <>
      <span class="mi">
        <Icon name={props.icon} />
      </span>
      <span class="grow">
        <span class="mt">{props.title}</span>
        <span class="small muted block">{props.later ?? props.sub}</span>
      </span>
      {props.chip && !props.later && (
        <span class="chip lock">
          <Icon name="lock" />
          {props.chip}
        </span>
      )}
      {props.to && <Icon name="chevRight" />}
    </>
  );
  return props.to ? (
    <a class="mrow" href={props.to}>
      {body}
    </a>
  ) : (
    <div class="mrow later" aria-disabled="true">
      {body}
    </div>
  );
}

export function MoreScreen() {
  const live = useSnapshot();
  const snap = live.state === 'ready' ? live.value : null;
  const settings = useSettings();
  const days = daysSinceBackup(settings.lastBackupAt, useNow());
  const storage = useStorageStatus();
  const storageText = !storage
    ? ''
    : ` · persistent storage ${storage.persisted === null ? 'unknown' : storage.persisted ? 'granted' : 'not granted'}${storage.usage === null ? '' : ` · ${formatBytes(storage.usage)} used`}`;
  const backupSub = `Last backup: ${days === null ? 'never' : days === 0 ? 'today' : `${plural(days, 'day')} ago`} · full or data only`;
  return (
    <>
      <TopBar title="More" />
      <div class="mbody">
        <div class="lockcard off">
          <div class="lockcard-h">
            <Icon name="lock" class="ic lg" />
            <h2 class="h2">Mentor tools</h2>
          </div>
          <p>
            Students can add items, change counts, desired, spares, locations, notes and photos without a PIN. A mentor PIN is needed to delete items, change vendors or prices, manage
            suppliers, rename or remove categories and locations, restore, import prices and change settings.
          </p>
          <p class="small">The PIN pad comes in a later build (M6). Until then, those steps ask you to confirm instead.</p>
        </div>
        <div class="mcol">
          <div class="grp">
            <h3>Manage</h3>
            <Row icon="truck" title="Suppliers" sub={snap ? `${plural(snap.suppliers.length, 'supplier')} · add, rename, remove` : 'Add, rename, remove'} chip="PIN to change" to={href.list('suppliers')} />
            <Row icon="folder" title="Categories" sub={snap ? `${plural(snap.categories.length, 'category', 'categories')} · add and reorder anytime` : 'Add and reorder anytime'} chip="PIN to rename/remove" to={href.list('categories')} />
            <Row
              icon="pin"
              title="Locations"
              sub={snap ? `${snap.locations.length ? plural(snap.locations.length, 'location') : 'No locations yet'} · walk order for count-in` : 'Bins, totes and shelves · walk order for count-in'}
              chip="PIN to rename/remove"
              to={href.list('locations')}
            />
            <Row icon="upload" title="Backup, restore & price import" sub={backupSub} chip="PIN to restore/import" to={href.backup} />
          </div>
          <div class="grp">
            <h3>Mentor PIN &amp; settings</h3>
            <Row icon="shield" title="Change PIN" sub="" later="Coming in a later build (M6)" />
            <Row icon="help" title="Forgot the PIN?" sub="" later="Coming in a later build (M6)" />
            <Row icon="clock" title="Reminders & limits" sub="" later="Backup reminder 7 days · stale price 90 days · unlock 5 minutes — changeable in M6" />
          </div>
          <div class="grp">
            <h3>About</h3>
            <Row icon="database" title="FRC 2408 Inventory Management" sub={`${snap ? `${plural(snap.items.length, 'item')} on this tablet` : 'Stored on this tablet'}${storageText}`} />
          </div>
        </div>
      </div>
    </>
  );
}
