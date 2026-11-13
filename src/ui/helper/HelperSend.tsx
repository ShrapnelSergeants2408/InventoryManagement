// Send tab (§18.4, mockup 11c): Send my counts builds the cumulative counts file and opens the
// share sheet. "Last sent … · n changes not sent yet". Opening another kit and Leave helper
// mode both ask about unsent changes first (§18.2).
import { useState } from 'preact/hooks';
import { confirmSent, helperItems, joinKit, leaveHelperMode, markSent, pendingPhotos, type HelperDb, type HelperState } from '../../data/helper-db';
import { formatDateTime, nowLocalIso } from '../../domain/dates';
import { sendSummary } from '../../domain/helper-mode';
import { buildCountsFile, countsFileName, type ReadKit } from '../../io/count-kit';
import { shareOrDownload } from '../../io/share';
import { TopBar, plural } from '../components/common';
import { Dialog, DialogActions } from '../components/Dialog';
import { forgetAllThumbnails, useNow } from '../data-hooks';
import { FolderLink } from '../components/FolderLink';
import { Icon } from '../icons';
import { showToast } from '../shell/toast';
import { KitPicker, KitSummary } from './KitPicker';
import { countPrefsForKit } from './session';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Waiting for an answer: replace the kit with a new one, or leave helper mode. */
type Asking = { kind: 'kit'; read: ReadKit } | { kind: 'leave' } | null;

export function HelperSendScreen({ db, state, onLeft }: { db: HelperDb; state: HelperState; onLeft: () => void }) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<Asking>(null);
  const s = sendSummary(state.changes);
  // The last counts file is only in this device's Downloads (v0.19).
  const saved = state.sent.saved ?? null;
  const name = countsFileName(state.kit.helperName, new Date(now));

  /** Sends; true once the file reached the share sheet or Downloads. */
  const send = async (): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const at = new Date();
      const sequence = state.sent.sequence + 1;
      const blob = await buildCountsFile({
        kit: state.kit,
        deviceId: state.deviceId,
        sequence,
        createdAt: nowLocalIso(),
        changes: state.changes,
        items: await helperItems(db),
        pending: state.pending,
        pendingPhotos: await pendingPhotos(db),
        now: at,
      });
      const file = countsFileName(state.kit.helperName, at);
      const result = await shareOrDownload(new File([blob], file, { type: 'application/zip' }), `Counts from ${state.kit.helperName}`);
      if (result === 'cancelled') return false;
      // Saved to Downloads isn't sent (v0.19): the screen says so until "I've sent it".
      await markSent(db, sequence, at.getTime(), result === 'downloaded' ? file : undefined);
      showToast(result === 'shared' ? `Sent ${file}.` : `Saved ${file} to Downloads. Send it to the shop tablet by Quick Share, Drive, email or Bluetooth.`);
      return true;
    } catch (e) {
      showToast(`Couldn’t build the counts file: ${message(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openKit = async (read: ReadKit) => {
    setBusy(true);
    try {
      await joinKit(db, read);
      countPrefsForKit(read.kit);
      forgetAllThumbnails();
      setAsking(null);
      showToast(`Opened the kit for ${read.kit.helperName}.`);
      location.hash = '#/count';
    } catch (e) {
      showToast(`Couldn’t open the kit: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    setBusy(true);
    try {
      await leaveHelperMode(db);
      forgetAllThumbnails();
      history.replaceState(null, '', location.pathname + location.search);
      onLeft();
    } catch (e) {
      setBusy(false);
      showToast(`Couldn’t clear the helper data: ${message(e)}`);
    }
  };

  const rows: Array<[string, number]> = [
    ['Items counted', s.counted],
    ['Location changes', s.locationChanges],
    ['Barcodes attached', s.barcodes],
    ['New locations', s.newLocations],
    ['New items (pending)', s.newItems],
    ['Counted outside my groups', s.outside],
  ];

  return (
    <>
      <TopBar title="Send my counts" subtitle="Back to the shop tablet" />
      <div class="cbody hsend">
        <div class="card hlast">
          <Icon name="clock" class="ic xl" />
          <div class="grow">
            <div class="hlast-h">
              {state.sent.at === null ? 'Not sent yet' : `${saved ? 'Saved to Downloads' : 'Last sent'} ${formatDateTime(new Date(state.sent.at), new Date(now))}`}
            </div>
            <div class="small muted">
              {state.unsent === 0 ? (state.sent.at === null ? 'Nothing counted yet' : saved ? 'Not on the shop tablet yet' : 'Everything is sent') : `${plural(state.unsent, 'change')} not sent yet`}
            </div>
          </div>
        </div>
        {saved && (
          <div class="hwarn hsaved" role="status">
            <Icon name="low" />
            <div class="grow">
              <strong class="mono">{saved}</strong> is in this device’s Downloads. The shop tablet doesn’t have it yet: upload it to the team’s Drive folder, or send it by Quick Share or email.
            </div>
            <button type="button" class="btn" disabled={busy} onClick={() => void confirmSent(db).catch((e: unknown) => showToast(message(e)))}>
              <Icon name="check" />
              I’ve sent it
            </button>
          </div>
        )}
        <div class="card hsum">
          {rows.map(([k, v]) => (
            <div key={k} class="hsum-r">
              <span>{k}</span>
              <strong class="tnum">{v}</strong>
            </div>
          ))}
        </div>
        <div class="hinfo">
          <Icon name="info" />
          <span>
            Every file includes <strong>everything</strong> since you opened the kit, so sending again is always safe. Phones can clear website data after a few days, so send
            before you leave.
          </span>
        </div>
        <div class="hsend-go">
          <button type="button" class="btn pri lg" disabled={busy} onClick={() => void send()}>
            <Icon name="upload" />
            Send my counts
          </button>
          <p class="small muted m0">
            Creates <span class="mono">{name}</span> and opens the share menu.
          </p>
        </div>
        <div class="card hmore hhow">
          <h2 class="h2">How to send</h2>
          <FolderLink url={state.kit.countsFolderUrl ?? ''} label="Open the Counts folder" />
          <ol class="hhow-l">
            <li>
              Tap <strong>Send my counts</strong>. If a share menu opens, pick Drive, Quick Share or email.
            </li>
            <li>
              If it says <strong>Saved to Downloads</strong>, upload the <span class="mono">counts-…zip</span> file to the team’s Drive folder › <strong>Counts</strong>, then tap <strong>I’ve sent it</strong>.
            </li>
            <li>Tell a mentor. Do this every time before you leave.</li>
            <li>Next time, just open the app and keep counting. You don’t need a new kit.</li>
          </ol>
        </div>
        <div class="card hmore">
          <h2 class="h2">Another count kit</h2>
          <p class="small muted m0">Opening a new kit replaces everything on this device with the new kit’s copy.</p>
          <KitPicker label="Open a new kit…" kitsFolderUrl={state.kit.kitsFolderUrl ?? ''} onRead={(read) => (state.unsent > 0 ? setAsking({ kind: 'kit', read }) : void openKit(read))} />
        </div>
        <div class="card hmore">
          <h2 class="h2">Finished counting for good?</h2>
          <p class="small muted m0">Leaving clears this device’s copy of the inventory, your counts and new items. The shop tablet keeps everything you sent.</p>
          <div>
            <button type="button" class="btn danger lg" disabled={busy} onClick={() => setAsking({ kind: 'leave' })}>
              <Icon name="trash" />
              Leave helper mode
            </button>
          </div>
        </div>
      </div>
      {asking && (
        <Dialog label={asking.kind === 'kit' ? 'Open a new kit' : 'Leave helper mode'} role="alertdialog" onClose={() => !busy && setAsking(null)}>
          <div class="dlg-form">
            <h2 class="h2">{asking.kind === 'kit' ? 'Open a new kit?' : 'Leave helper mode?'}</h2>
            {asking.kind === 'kit' && <KitSummary read={asking.read} />}
            {state.unsent > 0 ? (
              <p class="dlg-p">
                <strong>
                  {plural(state.unsent, 'change')} {state.unsent === 1 ? 'hasn’t' : 'haven’t'} been sent
                </strong> to the shop tablet. Send your counts first, or they’re lost.
              </p>
            ) : saved ? (
              <p class="dlg-p">
                This clears this device’s copy of the inventory. <strong>Your last counts file was only saved to Downloads.</strong> Make sure it reached the shop tablet first; the file itself stays in Downloads.
              </p>
            ) : (
              <p class="dlg-p">This clears this device’s copy of the inventory. Everything you counted was sent.</p>
            )}
            <DialogActions>
              <button type="button" class="btn lg" disabled={busy} onClick={() => setAsking(null)}>
                Cancel
              </button>
              {state.unsent > 0 && (
                <button type="button" class="btn pri lg" data-autofocus disabled={busy} onClick={() => void send()}>
                  <Icon name="upload" />
                  Send my counts first
                </button>
              )}
              <button type="button" class="btn danger lg" disabled={busy} onClick={() => void (asking.kind === 'kit' ? openKit(asking.read) : leave())}>
                <Icon name="trash" />
                {state.unsent > 0 ? (asking.kind === 'kit' ? 'Discard unsent counts' : 'Discard and leave') : asking.kind === 'kit' ? 'Open the new kit' : 'Leave helper mode'}
              </button>
            </DialogActions>
          </div>
        </Dialog>
      )}
    </>
  );
}
