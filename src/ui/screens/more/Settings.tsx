// Settings (F18): the backup reminder period. H4 adds sign-out and devices.
import { useState } from 'preact/hooks';
import { REMINDER_DAYS_MAX, setSettings } from '../../../data/settings';
import { BackButton, TopBar } from '../../components/common';
import { useDb, useSettings } from '../../data-hooks';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';

export function SettingsScreen() {
  const db = useDb();
  const settings = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? String(settings.reminderDays);
  const dirty = draft !== null && draft.trim() !== String(settings.reminderDays);

  const save = async () => {
    const t = value.trim();
    const n = Number(t);
    if (!/^\d+$/.test(t) || n > REMINDER_DAYS_MAX) {
      setError(`Backup reminder must be a whole number of days from 0 to ${REMINDER_DAYS_MAX} (0 turns it off)`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await setSettings(db, { reminderDays: n });
      setDraft(null);
      showToast('Settings saved.');
    } catch (e) {
      showToast(`Couldn’t save the settings: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar
        title="Settings"
        back={<BackButton label="More" fallback={href.tab('more')} />}
        actions={
          <button type="button" class="btn pri" disabled={!dirty || busy} onClick={() => void save()}>
            Save
          </button>
        }
      />
      <div class="fbody">
        <div class="setform card">
          <div class="setrow">
            <label class="lbl" for="set-reminder">
              Backup reminder
            </label>
            <div class="setin">
              <input
                id="set-reminder"
                class={error ? 'field setnum bad' : 'field setnum'}
                inputMode="numeric"
                value={value}
                disabled={busy}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby="set-reminder-help"
                onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
              />
              <span class="setunit">
                days <span class="small muted">(0–{REMINDER_DAYS_MAX})</span>
              </span>
            </div>
            <p class="small muted" id="set-reminder-help">
              The Inventory and Backup screens show a reminder when no backup has been made for this long. 0 turns the reminder off.
            </p>
            {error && (
              <p class="set-err" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
