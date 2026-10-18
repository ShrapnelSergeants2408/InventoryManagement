// The named settings a mentor can change (§6, S9) and their allowed ranges.

export interface NamedSettings {
  reminderDays: number;
  staleDays: number;
  unlockMinutes: number;
}

export const SETTING_LIMITS: Readonly<Record<keyof NamedSettings, { min: number; max: number; label: string; unit: string }>> = {
  reminderDays: { min: 1, max: 60, label: 'Backup reminder', unit: 'days' },
  staleDays: { min: 7, max: 365, label: 'Stale-price age', unit: 'days' },
  unlockMinutes: { min: 1, max: 30, label: 'Unlock length', unit: 'minutes' },
};

export type SettingsDraft = Record<keyof NamedSettings, string>;

export type SettingsResult = { ok: true; value: NamedSettings } | { ok: false; errors: Partial<Record<keyof NamedSettings, string>> };

export function checkSettings(d: SettingsDraft): SettingsResult {
  const errors: Partial<Record<keyof NamedSettings, string>> = {};
  const value = {} as NamedSettings;
  for (const key of Object.keys(SETTING_LIMITS) as (keyof NamedSettings)[]) {
    const { min, max, label, unit } = SETTING_LIMITS[key];
    const t = d[key].trim();
    const n = Number(t);
    if (!/^\d+$/.test(t) || n < min || n > max) errors[key] = `${label} must be a whole number of ${unit} from ${min} to ${max}`;
    else value[key] = n;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
