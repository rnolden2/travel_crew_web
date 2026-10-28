import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fetchSharedTripData, createWebServer} from '../server.mjs';
import {tripAppLink, validTripId} from '../src/trip-share/redirect.js';

const tripId = '09e04f90-1acd-4f38-828f-32a359cc25e1';
function fixture(overrides = {}, onRead = () => {}) {
  const records = new Map(Object.entries({
    [`trips/${tripId}`]: {id: tripId, title: 'Tokyo', isShared: true, isPrivate: true, createdBy: 'owner', joinedUsers: ['member', 'departed', 'restricted'], tripStatus: 'upcoming', expenses: ['private'], chat: 'private', images: [], ...overrides},
    'users/owner': {uid: 'owner'}, 'users/member': {uid: 'member'},
    'publicProfile/owner': {displayName: 'Owner', email: 'private@example.com'},
    'publicProfile/member': {displayName: 'Member'}, 'publicProfile/departed': {displayName: 'Departed'},
    'publicProfile/restricted': {displayName: 'Restricted'}, 'safetyAccounts/restricted': {restricted: true},
    [`trips/${tripId}/members/member`]: {userId: 'member', status: 'active'},
    [`trips/${tripId}/members/departed`]: {userId: 'departed', status: 'left'},
    [`trips/${tripId}/activities/one`]: {title: 'Museum', startDateTime: '2027-04-10T10:00:00+09:00'},
    [`trips/${tripId}/activities/removed`]: {title: 'Removed', moderationRemoved: true},
    [`trips/${tripId}/activities/deleted`]: {title: '', isDeleted: true},
    [`trips/${tripId}/transportation/owner-flight`]: {userId: 'owner', displayName: 'Owner', mode: 'flight', notes: 'AB123'},
    [`trips/${tripId}/transportation/departed`]: {userId: 'departed', mode: 'flight', notes: 'PRIVATE'},
    [`trips/${tripId}/transportation/restricted`]: {userId: 'restricted', mode: 'flight', notes: 'PRIVATE'},
  }));
  const reads = [];
  function snapshot(path) {
    const value = records.has(path) ? structuredClone(records.get(path)) : undefined;
    return {id: path.split('/').at(-1), exists: value !== undefined, data: () => value};
  }
  const doc = (path) => ({collection: (name) => collection(`${path}/${name}`), get: async () => { reads.push(path); const result = snapshot(path); onRead(path, records); return result; }});
  const collection = (path, filter, maximum = Infinity, afterId = '') => ({
    doc: (id) => doc(`${path}/${id}`),
    where: (key, op, value) => collection(path, [key, value], maximum, afterId),
    orderBy: () => collection(path, filter, maximum, afterId),
    limit: (count) => collection(path, filter, count, afterId),
    startAfter: (last) => collection(path, filter, maximum, typeof last === 'string' ? last : last.id),
    get: async () => { reads.push(path); const docs = [...records.keys()].filter((p) => p.startsWith(`${path}/`) && p.split('/').length === path.split('/').length + 1)
      .filter((p) => !filter || records.get(p)[filter[0]] === filter[1])
      .filter((p) => p.split('/').at(-1) > afterId).sort().slice(0, maximum).map(snapshot);
      onRead(path, records); return {docs, empty: !docs.length}; },
  });
  return {db: {collection, getAll: async (...refs) => Promise.all(refs.map((ref) => ref.get()))}, records, reads};
}

test('explicit shared links work for private trips and exclude expenses, removed content and departed travelers', async () => {
  const {db} = fixture(); const result = await fetchSharedTripData(tripId, db);
  assert.equal(result.trip.title, 'Tokyo');
  assert.deepEqual(result.members.map((m) => m.displayName), ['Owner', 'Member']);
  assert.equal(result.trip.creatorDisplayName, 'Owner');
  assert.equal(result.trip.createdBy, undefined);
  assert.equal(result.trip.joinedUsers, undefined);
  assert.equal(result.members[0].uid, undefined);
  assert.equal(result.members[0].hometown, undefined);
  assert.equal(result.transportation[0].userId, undefined);
  assert.deepEqual(result.activities.map((a) => a.title), ['Museum']);
  assert.deepEqual(result.transportation.map((item) => item.notes), ['AB123']);
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
test('place photos require a currently shared trip and a stored photo name', async () => {
  const photoName = 'places/tokyo/photos/cover';
  const {db, records} = fixture({images: [`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=600&key=PRIVATE`]});
  let upstreamCalls = 0;
  const server = createWebServer({database: db, placePhotoApiKey: 'server-key',
    fetchPlacePhoto: async () => {
      upstreamCalls++;
      return new Response(Buffer.from('image'), {headers: {'content-type': 'image/jpeg'}});
    }});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shared = await fetchSharedTripData(tripId, db);
  const path = shared.trip.images[0];
  assert.match(path, /tripId=/);
  assert.match(path, /maxWidthPx=600/);
  assert.equal(path.includes('PRIVATE'), false);
  const image = await fetch(base + path);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(await image.text(), 'image');
  assert.equal(upstreamCalls, 1);
  assert.equal((await fetch(base + `/api/place-photo?tripId=${tripId}&name=places/other/photos/cover`)).status, 404);
  assert.equal((await fetch(base + `/api/place-photo?name=${photoName}`)).status, 400);
  assert.equal(upstreamCalls, 1);
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(base + path)).status, 404);
  assert.equal(upstreamCalls, 1);
  records.get(`trips/${tripId}`).isShared = true;
  records.get(`trips/${tripId}`).images = [];
  assert.equal((await fetch(base + path)).status, 404);
  records.get(`trips/${tripId}`).images = [photoName];
  records.set('safetyAccounts/owner', {restricted: true});
  assert.equal((await fetch(base + path)).status, 404);
  assert.equal(upstreamCalls, 1);
});

test('historical website place-photo URLs gain current trip authorization', async () => {
  const photoName = 'places/tokyo/photos/old-cover';
  const oldUrl = `https://travel-crew-web-101337609697.us-central1.run.app/api/place-photo?name=${photoName}&maxWidthPx=700`;
  const {db, records} = fixture({images: [oldUrl]});
  const shared = await fetchSharedTripData(tripId, db);
  assert.equal(shared.trip.images[0],
    `/api/place-photo?tripId=${tripId}&name=places%2Ftokyo%2Fphotos%2Fold-cover&maxWidthPx=700`);
  const server = createWebServer({database: db, placePhotoApiKey: 'server-key',
    fetchPlacePhoto: async () => new Response(Buffer.from('photo'),
      {headers: {'content-type': 'image/jpeg'}})});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + shared.trip.images[0])).status, 200);
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(base + shared.trip.images[0])).status, 404);
});

test('legacy Maps photo URLs keep stored keys out of shared links and use server credentials', async () => {
  const oldUrl = 'https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=REF_123&key=OLD_PRIVATE';
  const {db, records} = fixture({images: [oldUrl]});
  const shared = await fetchSharedTripData(tripId, db);
  const path = `/api/legacy-place-photo?tripId=${tripId}&index=0`;
  assert.equal(shared.trip.images[0], path);
  assert.equal(JSON.stringify(shared).includes('OLD_PRIVATE'), false);
  let calls = 0;
  const server = createWebServer({database: db, placePhotoApiKey: 'SERVER_KEY',
    fetchPlacePhoto: async (photoUrl, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      if (calls === 1) {
        assert.equal(photoUrl.hostname, 'maps.googleapis.com');
        assert.equal(photoUrl.searchParams.get('photo_reference'), 'REF_123');
        assert.equal(photoUrl.searchParams.get('key'), 'SERVER_KEY');
        return new Response(null, {status: 302,
          headers: {location: 'https://lh3.googleusercontent.com/photo'}});
      }
      assert.equal(photoUrl.hostname, 'lh3.googleusercontent.com');
      return new Response(Buffer.from('photo'), {headers: {'content-type': 'image/jpeg'}});
    }});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const image = await fetch(base + path);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(await image.text(), 'photo');
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(base + path)).status, 404);
  assert.equal(calls, 2);
});

test('legacy Maps proxy rejects unsafe redirects and revocation during fetch', async () => {
  const oldUrl = 'https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=REF_123&key=OLD_PRIVATE';
  const {db, records} = fixture({images: [oldUrl]});
  let unsafe = true;
  const server = createWebServer({database: db, placePhotoApiKey: 'SERVER_KEY',
    fetchPlacePhoto: async () => {
      if (unsafe) return new Response(null, {status: 302,
        headers: {location: 'http://127.0.0.1/private'}});
      records.get(`trips/${tripId}`).isShared = false;
      return new Response(Buffer.from('photo'), {headers: {'content-type': 'image/jpeg'}});
    }});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = `/api/legacy-place-photo?tripId=${tripId}&index=0`;
  assert.equal((await fetch(base + path)).status, 502);
  unsafe = false;
  assert.equal((await fetch(base + path)).status, 404);
  records.get(`trips/${tripId}`).isShared = true;
  records.get(`trips/${tripId}`).images = ['https://maps.googleapis.com/maps/api/place/photo?key=OLD_PRIVATE'];
  assert.deepEqual((await fetchSharedTripData(tripId, db)).trip.images, []);
});

test('place photo proxy rechecks access after fetch and rejects oversized bytes', async () => {
  const photoName = 'places/tokyo/photos/cover';
  const {db, records} = fixture({images: [photoName]});
  let changeDuringFetch = true;
  const server = createWebServer({database: db, placePhotoApiKey: 'server-key',
    fetchPlacePhoto: async () => {
      if (changeDuringFetch) {
        records.get(`trips/${tripId}`).isShared = false;
        return new Response(Buffer.from('image'), {headers: {'content-type': 'image/jpeg'}});
      }
      const body = new ReadableStream({start(controller) {
        controller.enqueue(new Uint8Array(11 * 1024 * 1024));
        controller.enqueue(new Uint8Array(11 * 1024 * 1024));
        controller.close();
      }});
      return new Response(body, {headers: {'content-type': 'image/jpeg'}});
    }});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = `/api/place-photo?tripId=${tripId}&name=${photoName}`;
  assert.equal((await fetch(base + path)).status, 404);
  records.get(`trips/${tripId}`).isShared = true;
  changeDuringFetch = false;
  assert.equal((await fetch(base + path)).status, 502);
});

test('shared Firebase trip photos use an authorized proxy without download tokens', async () => {
  const objectPath = 'uploads/owner/trip_images/cover.jpg';
  const directUrl = `https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/${encodeURIComponent(objectPath)}?alt=media&token=SECRET`;
  const {db, records} = fixture({images: [directUrl]});
  let reads = 0;
  const bucket = {file(path) {
    assert.equal(path, objectPath);
    reads++;
    return {getMetadata: async () => [{size: '5', contentType: 'image/jpeg', metadata: {firebaseStorageDownloadTokens: 'SECRET'}}],
      createReadStream: () => Readable.from([Buffer.from('image')])};
  }};
  const server = createWebServer({database: db, storageBucketName: 'app.appspot.com', storageBucket: bucket});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shared = await fetchSharedTripData(tripId, db);
  const path = shared.trip.images[0];
  assert.equal(path, `/api/trip-photo?tripId=${tripId}&index=0`);
  assert.equal(JSON.stringify(shared).includes('SECRET'), false);
  const image = await fetch(base + path);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(await image.text(), 'image');
  assert.equal(reads, 1);
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(base + path)).status, 404);
  assert.equal(reads, 1);
});

test('token-free trip photo references are scoped to the owner and trip', async () => {
  const objectPath = `private_uploads/owner/trip_images/${tripId}/cover.jpg`;
  const source = `gs://app.appspot.com/${objectPath}`;
  const {db, records} = fixture({images: [source]});
  let reads = 0;
  const bucket = {file(path) {
    assert.equal(path, objectPath);
    reads++;
    return {getMetadata: async () => [{size: '5', contentType: 'image/jpeg', metadata: {}}],
      createReadStream: () => Readable.from([Buffer.from('image')])};
  }};
  const server = createWebServer({database: db, storageBucketName: 'app.appspot.com', storageBucket: bucket});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = (await fetchSharedTripData(tripId, db)).trip.images[0];
  assert.equal(path, `/api/trip-photo?tripId=${tripId}&index=0`);
  assert.equal((await fetch(base + path)).status, 200);
  for (const invalid of [
    source.replace('/owner/', '/member/'),
    source.replace(`/${tripId}/`, '/another-trip/'),
    source.replace('app.appspot.com', 'other.appspot.com'),
    source.replace('/cover.jpg', '/../cover.jpg'),
  ]) {
    records.get(`trips/${tripId}`).images = [invalid];
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal(reads, 1);
  records.get(`trips/${tripId}`).images = [source];
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(base + path)).status, 404);
});

test('token-free profile photos are scoped to the current member', async () => {
  const objectPath = 'private_uploads/member/users_profile/avatar.jpg';
  const source = `gs://app.appspot.com/${objectPath}`;
  const {db, records} = fixture();
  records.get('publicProfile/member').profileImage = source;
  let reads = 0;
  const bucket = {file(path) {
    assert.equal(path, objectPath);
    reads++;
    return {getMetadata: async () => [{size: '5', contentType: 'image/jpeg', metadata: {}}],
      createReadStream: () => Readable.from([Buffer.from('image')])};
  }};
  const server = createWebServer({database: db, storageBucketName: 'app.appspot.com', storageBucket: bucket});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = (await fetchSharedTripData(tripId, db)).members[1].profileImage;
  assert.equal(path, `/api/profile-photo?tripId=${tripId}&index=1`);
  assert.equal((await fetch(base + path)).status, 200);
  records.get('publicProfile/member').profileImage = source.replace('/member/', '/owner/');
  assert.equal((await fetch(base + path)).status, 404);
  assert.equal(reads, 1);
});

test('shared member photos hide Storage tokens and revoke on membership or profile changes', async () => {
  const objectPath = 'uploads/member/users_profile/avatar.jpg';
  const directUrl = `https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/${encodeURIComponent(objectPath)}?alt=media&token=PROFILE_SECRET`;
  const {db, records} = fixture();
  records.get('publicProfile/member').profileImage = directUrl;
  let revokeDuringRead = false;
  let reads = 0;
  const bucket = {file(path) {
    assert.equal(path, objectPath);
    reads++;
    return {getMetadata: async () => [{size: '5', contentType: 'image/jpeg',
      metadata: {firebaseStorageDownloadTokens: 'PROFILE_SECRET'}}],
    createReadStream: () => {
      if (revokeDuringRead) records.get(`trips/${tripId}/members/member`).status = 'left';
      return Readable.from([Buffer.from('image')]);
    }};
  }};
  const server = createWebServer({database: db, storageBucketName: 'app.appspot.com', storageBucket: bucket});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shared = await fetchSharedTripData(tripId, db);
  const path = shared.members.find((member) => member.displayName === 'Member').profileImage;
  assert.equal(path, `/api/profile-photo?tripId=${tripId}&index=1`);
  assert.equal(JSON.stringify(shared).includes('PROFILE_SECRET'), false);
  const image = await fetch(base + path);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(await image.text(), 'image');
  revokeDuringRead = true;
  assert.equal((await fetch(base + path)).status, 404);
  records.get(`trips/${tripId}/members/member`).status = 'active';
  revokeDuringRead = false;
  records.get('publicProfile/member').profileImage = null;
  assert.equal((await fetch(base + path)).status, 404);
  assert.equal(reads, 2);
});

test('Firebase photo proxy rechecks source and rejects invalid objects', async () => {
  const objectPath = 'uploads/owner/trip_images/cover.jpg';
  const directUrl = `https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/${encodeURIComponent(objectPath)}?alt=media&token=SECRET`;
  const {db, records} = fixture({images: [directUrl]});
  let removeDuringRead = true;
  const bucket = {file: () => ({getMetadata: async () => [{size: '5', contentType: 'image/jpeg', metadata: {firebaseStorageDownloadTokens: 'SECRET'}}],
    createReadStream: () => {
      if (removeDuringRead) records.get(`trips/${tripId}`).images = [];
      return Readable.from([Buffer.from('image')]);
    }})};
  const server = createWebServer({database: db, storageBucketName: 'app.appspot.com', storageBucket: bucket});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = `/api/trip-photo?tripId=${tripId}&index=0`;
  assert.equal((await fetch(base + path)).status, 404);
  records.get(`trips/${tripId}`).images = [directUrl];
  removeDuringRead = false;
  assert.equal((await fetch(base + path.replace('index=0', 'index=1'))).status, 404);
  records.get(`trips/${tripId}`).images = [directUrl.replace('app.appspot.com', 'other.appspot.com')];
  assert.equal((await fetch(base + path)).status, 404);
  records.get(`trips/${tripId}`).images = [directUrl.replace('SECRET', 'WRONG')];
  assert.equal((await fetch(base + path)).status, 404);
});
test('a link revoked during nested reads is not returned', async () => {
  for (const revoke of [
    (records) => { records.get(`trips/${tripId}`).isShared = false; },
    (records) => { records.set('safetyAccounts/owner', {restricted: true}); },
    (records) => { records.get(`trips/${tripId}`).hotelAddress = 'New private address'; },
    (records) => { records.get(`trips/${tripId}`).joinedUsers = ['member']; },
  ]) {
    const {db} = fixture({}, (path, records) => {
      if (path === `trips/${tripId}/transportation`) revoke(records);
    });
    assert.equal(await fetchSharedTripData(tripId, db), null);
  }
});
test('legacy activities remain readable when the nested collection is empty', async () => {
  const {db, records} = fixture();
  records.delete(`trips/${tripId}/activities/one`); records.delete(`trips/${tripId}/activities/removed`);
  records.delete(`trips/${tripId}/activities/deleted`);
  records.set('activity/legacy', {tripId, title: 'Legacy activity'});
  assert.equal((await fetchSharedTripData(tripId, db)).activities[0].title, 'Legacy activity');
});
test('shared links include distinct legacy activities and respect canonical tombstones', async () => {
  const {db, records} = fixture();
  records.set('activity/old-only', {tripId, title: 'Old distinct'});
  records.set('activity/one', {tripId, title: 'Old duplicate'});
  records.set('activity/deleted', {tripId, title: 'Must stay deleted'});
  const result = await fetchSharedTripData(tripId, db);
  assert.deepEqual(result.activities.map((activity) => activity.title), ['Museum', 'Old distinct']);
});
test('canonical tombstones beyond the web page cap still mask legacy records', async () => {
  const {db, records} = fixture();
  for (let index = 0; index < 100; index++) {
    const id = `a${String(index).padStart(3, '0')}`;
    records.set(`trips/${tripId}/activities/${id}`, {title: id});
  }
  records.set(`trips/${tripId}/activities/z-masked`, {title: '', isDeleted: true});
  records.set('activity/z-masked', {tripId, title: 'Must stay deleted'});
  records.set('activity/old-only', {tripId, title: 'Old distinct'});
  const result = await fetchSharedTripData(tripId, db);
  assert.equal(result.activities.some((activity) => activity.title === 'Must stay deleted'), false);
  assert.equal(result.activities.some((activity) => activity.title === 'Old distinct'), true);
});

test('shared preview reads past the first 100 itinerary records without silent truncation', async () => {
  const {db, records} = fixture();
  for (let index = 0; index < 125; index++) {
    const id = `page-${String(index).padStart(3, '0')}`;
    records.set(`trips/${tripId}/activities/${id}`, {title: `Activity ${index}`});
    records.set(`activity/legacy-${id}`, {tripId, title: `Legacy ${index}`});
    records.set(`trips/${tripId}/transportation/${id}`, {userId: 'owner', mode: 'train', notes: id});
    records.set(`trips/${tripId}/lodgings/${id}`, {hotelName: `Hotel ${index}`});
  }
  const result = await fetchSharedTripData(tripId, db);
  assert.equal(result.activities.length, 251);
  assert.equal(result.transportation.length, 126);
  assert.equal(result.lodgings.length, 125);
  assert.ok(result.activities.some((item) => item.title === 'Activity 124'));
  assert.ok(result.activities.some((item) => item.title === 'Legacy 124'));
  assert.ok(result.transportation.some((item) => item.notes === 'page-124'));
  assert.ok(result.lodgings.some((item) => item.hotelName === 'Hotel 124'));
});

test('preview rejects collections beyond its supported bound instead of hiding records', async () => {
  const {db, records} = fixture();
  for (let index = 0; index < 2001; index++) {
    records.set(`trips/${tripId}/transportation/item-${String(index).padStart(4, '0')}`,
      {userId: 'owner', mode: 'bus'});
  }
  const server = createWebServer({database: db});
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/shared-trip?tripId=${tripId}`);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too many records/i);
});

test('summary avoids descendant reads and section pages reach beyond the old preview limit', async () => {
  const {db, records, reads} = fixture();
  for (let index = 0; index < 2010; index++) {
    records.set(`trips/${tripId}/transportation/item-${String(index).padStart(4, '0')}`,
      {userId: 'owner', mode: 'bus', notes: `Bus ${index}`});
  }
  const server = createWebServer({database: db}); servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const summary = await fetch(`${base}/api/shared-trip?tripId=${tripId}&summary=1`);
  assert.equal(summary.status, 200);
  assert.deepEqual((await summary.json()).transportation, []);
  assert.equal(reads.includes(`trips/${tripId}/transportation`), false);
  let cursor = null;
  let count = 0;
  do {
    const params = new URLSearchParams({tripId, section: 'transportation'});
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`${base}/api/shared-trip-section?${params}`);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.ok(page.items.length <= 50);
    count += page.items.length;
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(count, 2011);
  assert.equal((await fetch(`${base}/api/shared-trip-section?tripId=${tripId}&section=chat`)).status, 400);
  assert.equal((await fetch(`${base}/api/shared-trip-section?tripId=${tripId}&section=activities&cursor=bad/path`)).status, 400);
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(`${base}/api/shared-trip-section?tripId=${tripId}&section=transportation`)).status, 404);
});

test('activity pages include legacy records while canonical tombstones mask them', async () => {
  const {db, records} = fixture();
  records.set('activity/one', {tripId, title: 'Old museum'});
  records.set('activity/old-only', {tripId, title: 'Old tour'});
  records.set('activity/tombstone', {tripId, title: 'Should be hidden'});
  records.set(`trips/${tripId}/activities/tombstone`, {isDeleted: true});
  const server = createWebServer({database: db}); servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/shared-trip-section?tripId=${tripId}&section=activities`;
  const nested = await (await fetch(base)).json();
  assert.equal(nested.nextSource, 'legacy');
  const legacy = await (await fetch(`${base}&source=legacy`)).json();
  assert.deepEqual(legacy.items.map((item) => item.title), ['Old tour']);
});

test('a member departure during a section read prevents a stale response', async () => {
  const {db, records} = fixture({}, (path, data) => {
    if (path === `trips/${tripId}/transportation`) {
      data.get(`trips/${tripId}/members/member`).status = 'left';
    }
  });
  records.set(`trips/${tripId}/transportation/member-ride`,
    {userId: 'member', mode: 'taxi', notes: 'Private pickup'});
  const server = createWebServer({database: db}); servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/shared-trip-section?tripId=${tripId}&section=transportation`);
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes('Private pickup'), false);
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
  const {db, records} = fixture({hotelName: 'Original hotel', expensePerNight: 99,
    lodgingCurrencyCode: 'USD'});
  records.set(`trips/${tripId}/lodgings/second`, {hotelName: 'Second hotel',
    hotelAddress: 'Main Street', expensePerNight: 80, currencyCode: 'EUR', privateNote: 'secret'});
  records.set(`trips/${tripId}/lodgings/blank`, {hotelName: '  '});
  records.set(`trips/${tripId}/lodgings/removed`, {hotelName: 'Hidden hotel', moderationRemoved: true});
  records.set(`trips/${tripId}/lodgings/deleted`, {hotelName: 'Deleted hotel', isDeleted: true});
  records.set(`trips/${tripId}/lodgings/second/likes/owner`, {userId: 'owner'});
  records.set(`trips/${tripId}/lodgings/second/likes/departed`, {userId: 'departed'});
  const data = await fetchSharedTripData(tripId, db);
  assert.deepEqual(data.lodgings.map((option) => option.hotelName), ['Original hotel', 'Second hotel']);
  assert.equal(data.lodgings[1].likesCount, 1);
  assert.deepEqual(data.lodgings.map((option) => option.currencyCode), ['USD', 'EUR']);
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
  assert.equal((await fetch(url + 'deleted')).status, 404);
  assert.equal((await fetch(url + 'another-trip-activity')).status, 404);
  assert.equal((await fetch(url + 'bad/path')).status, 400);
  records.set(`trips/${tripId}/activities/unscheduled`, {title: 'Unscheduled'});
  assert.equal((await fetch(url + 'unscheduled')).status, 422);
  records.get(`trips/${tripId}`).isShared = false;
  assert.equal((await fetch(url + 'one')).status, 404);
});

test('transportation exposes only canonical fields from current authors', async () => {
  const {db, records} = fixture();
  records.set(`trips/${tripId}/transportation/ride`, {userId: 'member',
    displayName: 'Member', mode: 'rideshare', notes: 'Pickup outside',
    provider: 'UNSUPPORTED', privateToken: 'SECRET'});
  records.set(`trips/${tripId}/transportation/removed`, {userId: 'owner', mode: 'bus', moderationRemoved: true});
  records.set(`trips/${tripId}/transportation/deleted`, {userId: 'owner', mode: 'taxi', isDeleted: true});
  const result = await fetchSharedTripData(tripId, db);
  assert.deepEqual(result.transportation.map((item) => item.mode).sort(), ['flight', 'rideshare']);
  const ride = result.transportation.find((item) => item.mode === 'rideshare');
  assert.equal(ride.notes, 'Pickup outside');
  assert.equal(ride.provider, undefined);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(result.flights, undefined);
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
