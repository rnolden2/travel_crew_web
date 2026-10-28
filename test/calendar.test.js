import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tripCalendar, activityCalendar} from '../src/trip-share/calendar.js';
import {hasLodging} from '../src/trip-share/sections.js';

test('all-day calendars preserve written dates and include the last day', () => {
  for (const [start, end, exclusive] of [
    ['2027-03-13T00:00:00+09:00', '2027-03-15T00:00:00+09:00', '20270316'],
    ['2027-12-31', '2027-12-31', '20280101'],
    ['2028-02-28', '2028-02-29', '20280301'],
  ]) {
    const calendar = tripCalendar({id: 'trip', tripStartDate: start, tripEndDate: end});
    assert.ok(calendar.includes(`DTSTART;VALUE=DATE:${start.slice(0, 10).replaceAll('-', '')}`));
    assert.ok(calendar.includes(`DTEND;VALUE=DATE:${exclusive}`));
  }
  assert.ok(tripCalendar({id: 'trip', startDate: '2027-01-01'}).includes('DTEND;VALUE=DATE:20270102'));
  for (const dates of [{}, {startDate: '2027-02-30'}, {startDate: 'invalid'}, {startDate: '2027-01-02', endDate: '2027-01-01'}]) assert.equal(tripCalendar(dates), null);
});
test('calendar text escapes injections and folds Unicode within 75 octets', () => {
  const calendar = tripCalendar({id: 'trip', startDate: '2027-01-01', title: 'Tokyo, Japan; \\ test\nEND:VEVENT\n' + '🌸'.repeat(60)});
  assert.equal(calendar.split('\r\n').filter((line) => line === 'END:VEVENT').length, 1);
  assert.ok(calendar.includes('Tokyo\\, Japan\\; \\\\ test\\nEND:VEVENT\\n'));
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
});
test('blank category fields do not count as lodging', () => {
  assert.equal(hasLodging({hotelName: '  ', checkInDate: 'invalid', expensePerNight: 0}), false);
  assert.equal(hasLodging({hotelName: 'Hotel'}), true);
});


test('individual activity calendars preserve offsets, duration, location and notes', () => {
  const activity = {id: 'museum', title: 'Museum', location: 'Tokyo', description: 'Bring tickets', startDateTime: '2027-04-10T10:00:00+09:00', endDateTime: '2027-04-10T11:30:00+09:00'};
  const calendar = activityCalendar('trip', activity);
  assert.ok(calendar.includes('DTSTART:20270410T010000Z'));
  assert.ok(calendar.includes('DTEND:20270410T023000Z'));
  assert.ok(calendar.includes('LOCATION:Tokyo'));
  assert.ok(calendar.includes('Bring tickets'));
  assert.ok(calendar.includes('UID:trip-activity-museum@travelcrew.app'));
  assert.equal(calendar.match(/BEGIN:VEVENT/g).length, 1);
});
test('floating activity times remain floating; missing ends default to one hour across midnight', () => {
  const calendar = activityCalendar('trip', {id: 'one', startDateTime: '2027-12-31T23:30:00'});
  assert.ok(calendar.includes('DTSTART:20271231T233000\r\n'));
  assert.ok(calendar.includes('DTEND:20280101T003000\r\n'));
  const zoned = activityCalendar('trip', {id: 'one', startDateTime: '2027-03-14T01:30:00-08:00', endDateTime: '2027-03-14T03:30:00-07:00'});
  assert.ok(zoned.includes('DTSTART:20270314T093000Z'));
  assert.ok(zoned.includes('DTEND:20270314T103000Z'));
});
test('unscheduled, invalid and mixed-zone activity times cannot be exported', () => {
  for (const activity of [
    {}, {startDateTime: '2027-04-10'}, {startDateTime: '2027-02-30T10:00:00'},
    {startDateTime: '2027-04-10T25:00:00Z'},
    {startDateTime: '2027-04-10T10:00:00Z', endDateTime: 'invalid'},
    {startDateTime: '2027-04-10T10:00:00Z', endDateTime: '2027-04-10T10:00:00Z'},
    {startDateTime: '2027-04-10T10:00:00Z', endDateTime: '2027-04-10T09:00:00Z'},
    {startDateTime: '2027-04-10T10:00:00', endDateTime: '2027-04-10T11:00:00Z'},
  ]) assert.equal(activityCalendar('trip', activity), null);
});
