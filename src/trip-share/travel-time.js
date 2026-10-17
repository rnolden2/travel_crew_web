// Render the clock supplied for the venue, independent of the browser's zone.
// Offsets are retained for calendar exports; never invent a destination zone.
export function formatTravelTime(value, {dateOnly = false} = {}) {
  if (typeof value !== 'string') return '';
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match) return '';
  const [, day, time] = match;
  const wall = new Date(`${day}T${time || '00:00:00'}Z`);
  if (!Number.isFinite(wall.getTime())) return '';
  const options = {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'};
  if (!dateOnly && time) Object.assign(options, {hour: 'numeric', minute: '2-digit'});
  return wall.toLocaleString('en-US', options);
}
