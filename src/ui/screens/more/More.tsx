// More (§17, mockups 9a, 9d): the mentor-tools card (unlock, countdown, lock now), the
// managed lists, Backup, and the mentor PIN & settings.
import { useState } from 'preact/hooks';
import { TopBar, plural } from '../../components/common';
import { daysSinceBackup } from '../../../domain/backup-reminder';
import { formatBytes } from '../../../domain/dates';
import { APP_VERSION } from '../../../io/backup';
import { useNow, useSettings, useSnapshot, useStorageStatus } from '../../data-hooks';
import { Icon, type IconName } from '../../icons';
import { lockNow, formatRemaining } from '../../../security/lock';
import { gate } from '../../../security/gate';
import { unlockReason, useCloseOnRelock, useUnlockRemaining } from '../../shell/LockPill';
import { href } from '../../shell/router';
import { ChangePinDialog, ForgotPinDialog } from './PinDialogs';

function Row(props: { icon: IconName; title: string; sub: string; chip?: string; to?: string; later?: string; onClick?: () => void }) {
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
      {(props.to || props.onClick) && <Icon name="chevRight" />}
    </>
  );
  if (props.onClick) {
    return (
      <button type="button" class="mrow" onClick={props.onClick}>
        {body}
      </button>
    );
  }
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
  const [dialog, setDialog] = useState<'change' | 'forgot' | null>(null);
  useCloseOnRelock(dialog === 'change', () => setDialog(null));
  const backupSub = `Last backup: ${days === null ? 'never' : days === 0 ? 'today' : `${plural(days, 'day')} ago`} · full or data only`;
  return (
    <>
      <TopBar title="More" />
      <div class="mbody">
        <LockCard />
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
            <Row
              icon="shield"
              title="Change PIN"
              sub="4–6 digits, stored hashed on this tablet"
              chip="PIN"
              onClick={() => void gate('Changing the PIN needs the mentor PIN.').then((ok) => ok && setDialog('change'))}
            />
            <Row icon="help" title="Forgot the PIN?" sub="Use the one-time recovery code from setup" onClick={() => setDialog('forgot')} />
            <Row
              icon="clock"
              title="Reminders & limits"
              sub={`Backup reminder ${plural(settings.reminderDays, 'day')} · stale price ${plural(settings.staleDays, 'day')} · unlock ${plural(settings.unlockMinutes, 'minute')}`}
              chip="PIN"
              to={href.settings}
            />
          </div>
          <div class="grp">
            <h3>About</h3>
            <Row icon="database" title="FRC 2408 Inventory Management" sub={`${snap ? `${plural(snap.items.length, 'item')} on this tablet` : 'Stored on this tablet'}${storageText}`} />
            <Row icon="info" title={`App version ${APP_VERSION}`} sub={`Built ${new Date(__BUILD_TIME__).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`} />
          </div>
        </div>
      </div>
      {dialog === 'change' && <ChangePinDialog onClose={() => setDialog(null)} />}
      {dialog === 'forgot' && <ForgotPinDialog onClose={() => setDialog(null)} />}
    </>
  );
}

const STUDENTS =
  'Students can add items, change counts, desired, spares, locations, notes and photos without a PIN. A mentor PIN is needed to delete items, change vendors or prices, manage suppliers, rename or remove categories and locations, restore, import prices and change settings.';

function LockCard() {
  const left = useUnlockRemaining();
  const { unlockMinutes } = useSettings();
  if (left > 0) {
    return (
      <div class="lockcard on">
        <div class="lockcard-h">
          <Icon name="unlock" class="ic lg" />
          <h2 class="h2">Mentor tools unlocked</h2>
        </div>
        <div>
          <div class="small">Relocks by itself in</div>
          <div class="lock-big tnum">{formatRemaining(left)}</div>
        </div>
        <p>The same countdown shows on the lock button at the top of every screen. Tap it to lock early.</p>
        <button type="button" class="btn lg lock-now" onClick={lockNow}>
          <Icon name="lock" />
          Lock now
        </button>
      </div>
    );
  }
  return (
    <div class="lockcard off">
      <div class="lockcard-h">
        <Icon name="lock" class="ic lg" />
        <h2 class="h2">Mentor tools locked</h2>
      </div>
      <p>{STUDENTS}</p>
      <button type="button" class="btn navy lg" onClick={() => void gate(unlockReason(unlockMinutes))}>
        <Icon name="unlock" />
        Unlock for {plural(unlockMinutes, 'minute')}
      </button>
    </div>
  );
}
