// Add to Calendar (SPEC v3.0 F23): the seasons' dates as an .ics file, through the share sheet
// (or a download where sharing files isn't possible), for the iPhone's Calendar to import.
import { CALENDAR_FILE_NAME, seasonCalendarFile } from '../../../domain/ics';
import type { Season } from '../../../domain/types';
import { shareOrDownload } from '../../../io/share';
import { showToast } from '../../shell/toast';

export async function addToCalendar(seasons: readonly Season[], now = new Date()): Promise<void> {
  const dated = seasons.filter((s) => s.setupFrom && s.takedownBy);
  if (dated.length === 0) {
    showToast('No season has dates yet. Add them in More › Seasons.');
    return;
  }
  const file = new File([seasonCalendarFile(dated, now)], CALENDAR_FILE_NAME, { type: 'text/calendar' });
  try {
    const r = await shareOrDownload(file, 'Holiday seasons');
    if (r === 'downloaded') showToast('Saved holiday-seasons.ics. Open it to add the dates to Calendar.');
  } catch (e) {
    showToast(`Couldn't make the calendar file: ${e instanceof Error ? e.message : String(e)}`);
  }
}
