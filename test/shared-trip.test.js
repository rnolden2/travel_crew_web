import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {fetchSharedTripData, createWebServer} from '../server.mjs';
import {tripAppLink, validTripId} from '../src/trip-share/redirect.js';

const tripId = '09e04f90-1acd-4f38-828f-32a359cc25e1';
function fixture(overrides = {}) {
  const records = new Map(Object.entries({
    [`trips/${tripId}`]: {id: tripId, title: 'Tokyo', isShared: true, isPrivate: true, createdBy: 'owner', joinedUsers: ['member', 'departed', 'restricted'], tripStatus: 'upcoming', expenses: ['private'], chat: 'private', images: [], ...overrides},
    'users/owner': {uid: 'owner'}, 'publicProfile/owner': {displayName: 'Owner', email: 'private@example.com'},
    'publicProfile/member': {displayName: 'Member'}, 'publicProfile/departed': {displayName: 'Departed'},
    'publicProfile/restricted': {displayName: 'Restricted'}, 'safetyAccounts/restricted': {restricted: true},
    [`trips/${tripId}/members/member`]: {userId: 'member', status: 'active'},
    [`trips/${tripId}/members/departed`]: {userId: 'departed', status: 'left'},
    [`trips/${tripId}/activities/one`]: {title: 'Museum', startDateTime: '2027-04-10T10:00:00+09:00'},
    [`trips/${tripId}/activities/removed`]: {title: 'Removed', moderationRemoved: true},
    [`trips/${tripId}/flights/owner`]: {userId: 'owner', flightNumber: 'AB123'},
    [`trips/${tripId}/flights/departed`]: {userId: 'departed', flightNumber: 'PRIVATE'},
    [`trips/${tripId}/flights/restricted`]: {userId: 'restricted', flightNumber: 'PRIVATE'},
  }));
  const reads = [];
  function snapshot(path) { return {id: path.split('/').at(-1), exists: records.has(path), data: () => records.get(path)}; }
  const doc = (path) => ({collection: (name) => collection(`${path}/${name}`), get: async () => { reads.push(path); return snapshot(path); }});
  const collection = (path, filter) => ({
    doc: (id) => doc(`${path}/${id}`), where: (key, op, value) => collection(path, [key, value]), limit() { return this; },
    get: async () => { reads.push(path); const docs = [...records.keys()].filter((p) => p.startsWith(`${path}/`) && p.split('/').length === path.split('/').length + 1)
      .filter((p) => !filter || records.get(p)[filter[0]] === filter[1]).map(snapshot); return {docs, empty: !docs.length}; },
  });
  return {db: {collection}, records, reads};
}

test('explicit shared links work for private trips and exclude expenses, removed content and departed travelers', async () => {
  const {db} = fixture(); const result = await fetchSharedTripData(tripId, db);
  assert.equal(result.trip.title, 'Tokyo');
  assert.deepEqual(result.members.map((m) => m.uid), ['owner', 'member']);
  assert.deepEqual(result.trip.joinedUsers, ['member']);
  assert.deepEqual(result.activities.map((a) => a.title), ['Museum']);
  assert.deepEqual(result.flights.map((f) => f.flightNumber), ['AB123']);
  assert.equal(result.trip.expenses, undefined); assert.equal(result.trip.chat, undefined);
  assert.equal(result.members[0].email, undefined);
});
test('unshared, deleted and moderated trips do not trigger nested reads', async () => {
  for (const patch of [{isShared: false}, {isShared: 'true'}, {tripStatus: 'deleted'}, {moderationRemoved: true}]) {
    const {db, reads} = fixture(patch);
    assert.equal(await fetchSharedTripData(tripId, db), null);
    assert.deepEqual(reads, [`trips/${tripId}`]);
  }
});
test('owner restriction and account deletion disable the public preview', async () => {
  for (const [path, data] of [['safetyAccounts/owner', {restricted: true}], ['users/owner', {isDeleted: true}]]) {
    const {db, records} = fixture(); records.set(path, data);
    assert.equal(await fetchSharedTripData(tripId, db), null);
  }
});
test('legacy activities remain readable when the nested collection is empty', async () => {
  const {db, records} = fixture();
  records.delete(`trips/${tripId}/activities/one`); records.delete(`trips/${tripId}/activities/removed`);
  records.set('activity/legacy', {tripId, title: 'Legacy activity'});
  assert.equal((await fetchSharedTripData(tripId, db)).activities[0].title, 'Legacy activity');
});
test('app links match the mobile route and malformed IDs never reach Firestore', async () => {
  assert.equal(tripAppLink(tripId), `travelcrew://trips/${tripId}`);
  for (const value of ['../users', 'one/two', '', '<script>', 'a'.repeat(129)]) {
    assert.equal(validTripId(value), false); assert.equal(tripAppLink(value), null);
    const {db, reads} = fixture(); assert.equal(await fetchSharedTripData(value, db), null); assert.equal(reads.length, 0);
  }
});
const servers = [];
after(async () => { for (const server of servers) await new Promise((resolve) => server.close(resolve)); });
test('HTTP API validates requests, stays read-only and serves current routes', async () => {
  const {db} = fixture(); const server = createWebServer({database: db}); servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/shared-trip?tripId=${tripId}`)).status, 200);
  assert.equal((await fetch(`${base}/api/shared-trip?tripId=bad/path`)).status, 400);
  assert.equal((await fetch(`${base}/api/shared-trip?tripId=${tripId}`, {method: 'POST'})).status, 405);
  const redirect = await fetch(`${base}/about-us`, {redirect: 'manual'});
  assert.equal(redirect.headers.get('location'), '/#about');
  const config = await fetch(`${base}/runtime-config.js`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.ok(!(await config.text()).includes('GOOGLE_MAPS_SERVER_KEY'));
});

test('shared lodging includes legacy and individual options without publishing voters or hidden data', async () => {
  const {db, records} = fixture({hotelName: 'Original hotel', expensePerNight: 99});
  records.set(`trips/${tripId}/lodgings/second`, {hotelName: 'Second hotel', hotelAddress: 'Main Street', expensePerNight: 80, privateNote: 'secret'});
  records.set(`trips/${tripId}/lodgings/blank`, {hotelName: '  '});
  records.set(`trips/${tripId}/lodgings/removed`, {hotelName: 'Hidden hotel', moderationRemoved: true});
  records.set(`trips/${tripId}/lodgings/second/likes/owner`, {userId: 'owner'});
  records.set(`trips/${tripId}/lodgings/second/likes/departed`, {userId: 'departed'});
  const data = await fetchSharedTripData(tripId, db);
  assert.deepEqual(data.lodgings.map((option) => option.hotelName), ['Original hotel', 'Second hotel']);
  assert.equal(data.lodgings[1].likesCount, 1);
  assert.equal(data.lodgings[1].privateNote, undefined);
  assert.equal(data.lodgings[1].likedBy, undefined);
  assert.equal(data.trip.isPrivate, true);
});

test('calendar downloads enforce current sharing access and valid dates', async () => {
  const {db, records} = fixture({tripStartDate: '2027-04-10', tripEndDate: '2027-04-12'});
  const server = createWebServer({database: db}); servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/shared-trip?tripId=${tripId}&format=ics`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/calendar/);
  assert.ok((await response.text()).includes('DTEND;VALUE=DATE:20270413'));
  const trip = records.get(`trips/${tripId}`);
  trip.tripEndDate = '2027-04-01';
  assert.equal((await fetch(url)).status, 422);
  trip.isShared = false;
  assert.equal((await fetch(url)).status, 404);
});


test('individual activity downloads respect trip access and exclude removed or unrelated activities', async () => {
  const {db, records} = fixture();
  const server = createWebServer({database: db}); servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/shared-trip?tripId=${tripId}&format=ics&activityId=`;
  const response = await fetch(url + 'one');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /activity-one.ics/);
  const calendar = await response.text();
  assert.ok(calendar.includes('SUMMARY:Museum'));
  assert.ok(calendar.includes('DTSTART:20270410T010000Z'));
  assert.ok(calendar.includes('DTEND:20270410T020000Z'));
  assert.equal((await fetch(url + 'removed')).status, 404);
  assert.equal((await fetch(url + 'another-trip-activity')).status, 404);
  assert.equal((await fetch(url + 'bad/path')).status, 400);
  records.set(`trips/${tripId}/activities/unscheduled`, {title: 'Unscheduled'});
  assert.equal((await fetch(url + 'unscheduled')).status, 422);
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(url + 'one')).status, 404);
});

test('transportation mixes modes with old flights and exposes only allowed fields from current authors', async () => {
  const {db, records} = fixture();
  records.set(`trips/${tripId}/transportation/ride`, {userId: 'member', mode: 'rideshare', provider: 'Uber', travelerNames: ['Member'], notes: 'Pickup outside', privateToken: 'SECRET'});
  records.set(`trips/${tripId}/transportation/removed`, {userId: 'owner', mode: 'bus', moderationRemoved: true});
  records.set(`trips/${tripId}/transportation/departed`, {userId: 'departed', mode: 'train'});
  records.set(`trips/${tripId}/transportation/restricted`, {userId: 'restricted', mode: 'taxi'});
  records.set('flights/legacy', {tripId, userId: 'member', flightNumber: 'LEGACY123'});
  const result = await fetchSharedTripData(tripId, db);
  assert.deepEqual(result.transportation.map((entry) => entry.mode).sort(), ['flight', 'flight', 'rideshare']);
  assert.equal(result.transportation.find((entry) => entry.mode === 'rideshare').provider, 'Uber');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(result.flights.some((flight) => flight.flightNumber === 'LEGACY123'), true);
});

test('legacy trip summary is included once and new unscheduled flights remain visible', async () => {
  const {db, records} = fixture({flightNumber: 'AB123'});
  records.set(`trips/${tripId}/flights/new`, {userId: 'owner', transportTitle: 'Flight'});
  const result = await fetchSharedTripData(tripId, db);
  assert.equal(result.transportation.filter((entry) => entry.serviceNumber === 'AB123').length, 1);
  assert.equal(result.transportation.some((entry) => entry.title === 'Flight'), true);
});

test('moderated mirrored flights cannot reappear through legacy trip fields', async () => {
  const {db, records} = fixture({flightNumber: 'AB123'});
  records.set(`trips/${tripId}/flights/owner`, {userId: 'owner', flightNumber: 'AB123', moderationRemoved: true});
  const result = await fetchSharedTripData(tripId, db);
  assert.equal(result.transportation.some((entry) => entry.serviceNumber === 'AB123'), false);
  assert.equal(result.trip.flightNumber, null);
});

test('MCP flights stored as transportation retain local clocks, notes and saver name', async () => {
  const {db, records} = fixture();
  records.set(`trips/${tripId}/transportation/transport_0`, {
    id: 'transport_0', tripId, userId: 'owner', displayName: 'Randy', mode: 'flight',
    departure: '2027-03-14T02:30:00', arrival: '2027-03-14T01:30:00',
    notes: 'Example Air TC123, Tokyo to Los Angeles',
  });
  const result = await fetchSharedTripData(tripId, db);
  const saved = result.transportation.find((entry) => entry.notes === 'Example Air TC123, Tokyo to Los Angeles');
  assert.ok(saved);
  assert.equal(saved.mode, 'flight');
  assert.equal(saved.departure, '2027-03-14T02:30:00');
  assert.equal(saved.arrival, '2027-03-14T01:30:00');
  assert.equal(saved.displayName, 'Randy');
});
