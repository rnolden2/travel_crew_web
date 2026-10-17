import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatTravelTime} from '../src/trip-share/travel-time.js';

test('travel clocks remain at their venues without UTC offset labels', () => {
  assert.match(formatTravelTime('2027-04-10T10:00:00+09:00'), /10:00 AM$/);
  assert.match(formatTravelTime('2027-04-10T04:00:00-07:00'), /4:00 AM$/);
  assert.match(formatTravelTime('2027-03-14T02:30:00+09:00'), /2:30 AM/);
  assert.match(formatTravelTime('2027-04-10T10:00:00Z'), /10:00 AM$/);
});

test('date-only and floating values do not acquire a browser timezone', () => {
  assert.equal(formatTravelTime('2027-04-10'), 'Apr 10, 2027');
  assert.equal(formatTravelTime('2027-04-10T00:00:00.000', {dateOnly:true}), 'Apr 10, 2027');
  assert.match(formatTravelTime('2027-04-10T10:00:00'), /10:00 AM$/);
  assert.match(formatTravelTime('2027-03-14T02:30:00'), /2:30 AM$/);
  assert.equal(formatTravelTime('invalid'), '');
});
