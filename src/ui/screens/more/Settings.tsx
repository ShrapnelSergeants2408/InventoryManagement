// Reminders & limits (§6, S9): backup reminder, stale-price age and unlock length, and the
// order history's season start and school year start (§21.5). Anyone can read them; the fields
// stay locked until the PIN, and saving needs it (§6 "changing settings").
import { useEffect, useState } from 'preact/hooks';
import { setSettings } from '../../../data/settings';
import { formatIsoDate } from '../../../domain/dates';
import { centsToPlain, parsePrice } from '../../../domain/money';
import { isMonthDay } from '../../../domain/order-history';
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
  overdueDays: 'An order not fully received this long after it was placed is marked “Overdue” in the order history and on the Inventory screen.',
};

const toDraft = (s: NamedSettings): SettingsDraft => ({ reminderDays: String(s.reminderDays), staleDays: String(s.staleDays), unlockMinutes: String(s.unlockMinutes), overdueDays: String(s.overdueDays) });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Days in a month, in a year that isn't a leap year (February 29 isn't offered). */
const daysIn = (month: number) => new Date(Date.UTC(2025, month, 0)).getUTCDate();

/** Season start, school year start and the school-year budget as edited (§21.5, v0.17). */
interface HistoryDraft {
  seasonStart: string;
  schoolMonth: number;
  schoolDay: number;
  /** Dollars as typed; blank for no budget. */
  budget: string;
}

const toHistory = (s: { seasonStart: string; schoolYearStart: string; budgetCents: number | null }): HistoryDraft => {
  const md = isMonthDay(s.schoolYearStart) ? s.schoolYearStart : '08-01';
  return { seasonStart: s.seasonStart, schoolMonth: Number(md.slice(0, 2)), schoolDay: Number(md.slice(3)), budget: s.budgetCents === null ? '' : centsToPlain(s.budgetCents) };
};
const monthDay = (h: HistoryDraft) => `${String(h.schoolMonth).padStart(2, '0')}-${String(h.schoolDay).padStart(2, '0')}`;
const sameHistory = (a: HistoryDraft, b: HistoryDraft) => a.seasonStart === b.seasonStart && a.schoolMonth === b.schoolMonth && a.schoolDay === b.schoolDay && a.budget.trim() === b.budget.trim();

/** The budget as typed: cents, null for none, or the problem. */
function budgetOf(raw: string): { ok: true; cents: number | null } | { ok: false; error: string } {
  const p = parsePrice(raw);
  if (!p.ok) return { ok: false, error: `School-year budget: ${p.error}` };
  if (p.cents !== null && !Number.isSafeInteger(p.cents)) return { ok: false, error: 'School-year budget is too large' };
  return p;
}

export function SettingsScreen() {
  const db = useDb();
  const settings = useSettings();
  const saved = toDraft(settings);
  const unlocked = useUnlockRemaining() > 0;
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const savedHistory = toHistory(settings);
  const [hist, setHist] = useState<HistoryDraft | null>(null);
  const h = hist ?? savedHistory;
  const [errors, setErrors] = useState<Partial<Record<keyof NamedSettings, string>>>({});
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = draft ?? saved;
  const dirty = (draft !== null && KEYS.some((k) => draft[k] !== saved[k])) || (hist !== null && !sameHistory(hist, savedHistory));

  // Relocking leaves unsaved changes on screen; Save asks for the PIN again.
  useEffect(() => setErrors({}), [draft]);

  const save = async () => {
    const r = checkSettings(d);
    const b = budgetOf(h.budget);
    setBudgetError(b.ok ? null : b.error);
    if (!r.ok) setErrors(r.errors);
    if (!r.ok || !b.ok) return;
    if (!(await gate('Changing settings needs the mentor PIN.'))) return;
    setBusy(true);
    try {
      await setSettings(db, { ...r.value, seasonStart: h.seasonStart, schoolYearStart: monthDay(h), budgetCents: b.cents });
      setDraft(null);
      setHist(null);
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
        <div class="setform card" aria-label="Order history">
          <h2 class="h2">Order history</h2>
          <div class="setrow">
            <label class="lbl" for="set-season">
              Season starts
              {!unlocked && <Icon name="lock" />}
            </label>
            <div class="setin">
              <input id="set-season" class="field setdate" type="date" value={h.seasonStart} disabled={!unlocked || busy} aria-describedby="set-season-help" onInput={(e) => setHist({ ...h, seasonStart: (e.currentTarget as HTMLInputElement).value })} />
              {h.seasonStart !== '' && (
                <button type="button" class="btn" disabled={!unlocked || busy} onClick={() => setHist({ ...h, seasonStart: '' })}>
                  Clear
                </button>
              )}
            </div>
            <p class="small muted" id="set-season-help">
              {h.seasonStart ? `“This season” in the order history runs from ${formatIsoDate(h.seasonStart)} to today.` : 'Not set: the order history doesn’t offer “This season” until it is. Kickoff day is a good choice.'}
            </p>
          </div>
          <div class="setrow">
            <span class="lbl" id="set-school-l">
              School year starts
              {!unlocked && <Icon name="lock" />}
            </span>
            <div class="setin" role="group" aria-labelledby="set-school-l">
              <select class="field setsel" aria-label="School year start month" value={h.schoolMonth} disabled={!unlocked || busy} onChange={(e) => {
                const m = Number((e.currentTarget as HTMLSelectElement).value);
                setHist({ ...h, schoolMonth: m, schoolDay: Math.min(h.schoolDay, daysIn(m)) });
              }}>
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <select class="field setsel" aria-label="School year start day" value={h.schoolDay} disabled={!unlocked || busy} onChange={(e) => setHist({ ...h, schoolDay: Number((e.currentTarget as HTMLSelectElement).value) })}>
                {Array.from({ length: daysIn(h.schoolMonth) }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>
            <p class="small muted">“This school year” runs from this date to today; “Last school year” is the 12 months before it.</p>
          </div>
          <div class="setrow">
            <label class="lbl" for="set-budget">
              School-year budget <span class="lbl-opt">(optional)</span>
              {!unlocked && <Icon name="lock" />}
            </label>
            <div class="setin">
              <input
                id="set-budget"
                class={budgetError ? 'field setnum bad' : 'field setnum'}
                inputMode="decimal"
                value={h.budget}
                placeholder="none"
                disabled={!unlocked || busy}
                aria-invalid={budgetError ? 'true' : undefined}
                aria-describedby="set-budget-help"
                onInput={(e) => setHist({ ...h, budget: (e.currentTarget as HTMLInputElement).value })}
              />
              <span class="setunit">dollars</span>
            </div>
            <p class="small muted" id="set-budget-help">
              The spending summary shows what this school year’s orders have used of it and what’s left. Leave it blank for no budget.
            </p>
            {budgetError && (
              <p class="set-err" role="alert">
                {budgetError}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
