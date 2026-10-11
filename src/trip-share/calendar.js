// Preserve the written travel date rather than shifting it into the viewer's zone.
function calendarDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[0].slice(0, 10) ? date : null;
}
const dateText = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');
const escapeText = (text) => String(text ?? '').replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');

// RFC 5545 folds by UTF-8 octets, without splitting a Unicode code point.
function fold(line) {
  let result = ''; let length = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (length + size > 75) { result += '\r\n '; length = 1; }
    result += char; length += size;
  }
  return result;
}

export function tripCalendar(trip, now = new Date()) {
  const start = calendarDate(trip.tripStartDate || trip.startDate);
  const last = calendarDate(trip.tripEndDate || trip.endDate || trip.tripStartDate || trip.startDate);
  if (!start || !last || last < start) return null;
  const end = new Date(last); end.setUTCDate(end.getUTCDate() + 1);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travel Crew//Trip Calendar//EN',
    'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${escapeText(trip.id)}@travelcrew.app`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART;VALUE=DATE:${dateText(start)}`, `DTEND;VALUE=DATE:${dateText(end)}`,
    `SUMMARY:${escapeText(trip.title || trip.destination || 'Travel Crew trip')}`,
    `LOCATION:${escapeText([trip.destination, trip.country].filter(Boolean).join(', '))}`,
    'DESCRIPTION:Trip planned with Travel Crew',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}

function activityTime(value) {
  if (typeof value !== 'string' || !calendarDate(value) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  // Unzoned stored times remain floating calendar times; don't infer a destination zone.
  const date = new Date(zoned ? value : `${value}Z`);
  return Number.isFinite(date.getTime()) ? {date, zoned} : null;
}
const timeText = ({date, zoned}) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, zoned ? 'Z' : '');

export function activityCalendar(tripId, activity, now = new Date()) {
  const start = activityTime(activity.startDateTime);
  if (!start) return null;
  const end = activity.endDateTime == null || activity.endDateTime === ''
    ? {date: new Date(start.date.getTime() + 3600000), zoned: start.zoned}
    : activityTime(activity.endDateTime);
  if (!end || end.zoned !== start.zoned || end.date <= start.date) return null;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travel Crew//Activity Calendar//EN',
    'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${escapeText(tripId)}-activity-${escapeText(activity.id)}@travelcrew.app`,
    `DTSTAMP:${timeText({date: now, zoned: true})}`,
    `DTSTART:${timeText(start)}`, `DTEND:${timeText(end)}`,
    `SUMMARY:${escapeText(activity.title || 'Travel Crew activity')}`,
    `LOCATION:${escapeText(activity.location)}`,
    `DESCRIPTION:${escapeText([activity.description, 'Activity planned with Travel Crew'].filter(Boolean).join('\n\n'))}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}
