// More: the managed lists, Backup & restore, Settings and About.
import { TopBar, plural } from '../../components/common';
import { daysSinceBackup } from '../../../domain/backup-reminder';
import { formatBytes } from '../../../domain/dates';
import { APP_NAME, APP_VERSION } from '../../../io/backup';
import { useNow, useSettings, useSnapshot, useStorageStatus } from '../../data-hooks';
import { Icon, type IconName } from '../../icons';
import { href } from '../../shell/router';

function Row(props: { icon: IconName; title: string; sub: string; to?: string }) {
  const body = (
    <>
      <span class="mi">
        <Icon name={props.icon} />
      </span>
      <span class="grow">
        <span class="mt">{props.title}</span>
        <span class="small muted block">{props.sub}</span>
      </span>
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
  const reminder = settings.reminderDays === 0 ? 'Backup reminder off' : `Backup reminder every ${plural(settings.reminderDays, 'day')}`;
  return (
    <>
      <TopBar title="More" />
      <div class="mbody">
        <div class="mcol">
          <div class="grp">
            <h3>Manage</h3>
            <Row icon="folder" title="Categories" sub={snap ? `${plural(snap.categories.length, 'category', 'categories')} · add, rename, reorder` : 'Add, rename, reorder'} to={href.list('categories')} />
            <Row
              icon="area"
              title="Areas & spots"
              sub={snap ? (snap.areas.length ? `${plural(snap.areas.length, 'area')} · ${plural(snap.spots.length, 'spot')} · ${plural(snap.bins.length, 'bin')}` : 'No areas yet · rooms, shelves, bins') : 'Rooms, shelves, bins'}
              to={href.list('places')}
            />
            <Row icon="season" title="Seasons" sub={snap ? `${plural(snap.seasons.length, 'season')} · add, rename, reorder, colors` : 'Add, rename, reorder'} to={href.list('seasons')} />
            <Row icon="tag" title="Tags" sub={snap ? `${snap.tags.length ? plural(snap.tags.length, 'tag') : 'No tags yet'} · Fragile, Outdoor…` : 'Fragile, Outdoor…'} to={href.list('tags')} />
            <Row icon="upload" title="Backup & restore" sub={backupSub} to={href.backup} />
            <Row icon="clock" title="Settings" sub={reminder} to={href.settings} />
          </div>
          <div class="grp">
            <h3>About</h3>
            <Row icon="database" title={APP_NAME} sub={`${snap ? `${plural(snap.items.length, 'item')} on this phone` : 'Stored on this phone'}${storageText}`} />
            <Row icon="info" title={`App version ${APP_VERSION}`} sub={`Built ${new Date(__BUILD_TIME__).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`} />
          </div>
        </div>
      </div>
    </>
  );
}
