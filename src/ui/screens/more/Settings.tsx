// Reminders & limits (§6, S9): backup reminder, stale-price age and unlock length. Anyone can
// read them; the fields stay locked until the PIN, and saving needs it (§6 "changing settings").
import { useEffect, useState } from 'preact/hooks';
import { setSettings } from '../../../data/settings';
import { SETTING_LIMITS, checkSettings, type NamedSettings, type SettingsDraft } from '../../../domain/settings-limits';
import { gate } from '../../../security/gate';
import { BackButton, PinMark, TopBar } from '../../components/common';
import { useDb, useSettings } from '../../data-hooks';
import { Icon } from '../../icons';
import { useUnlockRemaining } from '../../shell/LockPill';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';

const KEYS = Object.keys(SETTING_LIMITS) as (keyof NamedSettings)[];

const HELP: Record<keyof NamedSettings, string> = {
  reminderDays: 'The Inventory and Backup screens show a reminder when no backup has been made for this long.',
  staleDays: 'Order-list prices checked longer ago than this are marked “Price n days old”.',
  unlockMinutes: 'How long mentor tools stay unlocked after the PIN. Takes effect the next time the PIN is entered.',
};

const toDraft = (s: NamedSettings): SettingsDraft => ({ reminderDays: String(s.reminderDays), staleDays: String(s.staleDays), unlockMinutes: String(s.unlockMinutes) });

export function SettingsScreen() {
  const db = useDb();
  const settings = useSettings();
  const saved = toDraft(settings);
  const unlocked = useUnlockRemaining() > 0;
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof NamedSettings, string>>>({});
  const [busy, setBusy] = useState(false);
  const d = draft ?? saved;
  const dirty = draft !== null && KEYS.some((k) => draft[k] !== saved[k]);

  // Relocking leaves unsaved changes on screen; Save asks for the PIN again.
  useEffect(() => setErrors({}), [draft]);

  const save = async () => {
    const r = checkSettings(d);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    if (!(await gate('Changing settings needs the mentor PIN.'))) return;
    setBusy(true);
    try {
      await setSettings(db, r.value);
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
        title="Reminders & limits"
        back={<BackButton label="More" fallback={href.tab('more')} />}
        actions={
          <button type="button" class="btn pri" disabled={!dirty || busy} onClick={() => void save()}>
            Save
            {!unlocked && <PinMark />}
          </button>
        }
      />
      <div class="fbody">
        <div class="setform card">
          {!unlocked && (
            <div class="lockbar">
              <Icon name="lock" />
              <span class="grow">Changing these needs the mentor PIN.</span>
              <button type="button" class="btn navy" onClick={() => void gate('Changing settings needs the mentor PIN.')}>
                <Icon name="unlock" />
                Unlock
              </button>
            </div>
          )}
          {KEYS.map((k) => {
            const lim = SETTING_LIMITS[k];
            return (
              <div class="setrow" key={k}>
                <label class="lbl" for={`set-${k}`}>
                  {lim.label}
                  {!unlocked && <Icon name="lock" />}
                </label>
                <div class="setin">
                  <input
                    id={`set-${k}`}
                    class={errors[k] ? 'field setnum bad' : 'field setnum'}
                    inputMode="numeric"
                    value={d[k]}
                    disabled={!unlocked || busy}
                    aria-invalid={errors[k] ? 'true' : undefined}
                    aria-describedby={`set-${k}-help`}
                    onInput={(e) => setDraft({ ...d, [k]: (e.currentTarget as HTMLInputElement).value })}
                  />
                  <span class="setunit">
                    {lim.unit} <span class="small muted">({lim.min}–{lim.max})</span>
                  </span>
                </div>
                <p class="small muted" id={`set-${k}-help`}>
                  {HELP[k]}
                </p>
                {errors[k] && (
                  <p class="set-err" role="alert">
                    {errors[k]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
