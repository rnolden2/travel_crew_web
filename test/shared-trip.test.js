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
