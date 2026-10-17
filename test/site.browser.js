import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createWebServer} from '../server.mjs';

process.env.VITE_PLAY_STORE_URL = '';
process.env.VITE_ASSISTANT_BASE_URL = '';
const server = createWebServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true});
const tripId = '09e04f90-1acd-4f38-828f-32a359cc25e1';
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const failedAssets = [];
  page.on('response', (response) => { if (response.url().includes('/assets/') && response.status() >= 400) failedAssets.push(response.url()); });
  await page.goto(base);
  await page.getByRole('heading', {name: /Your next adventure/}).waitFor();
  assert.equal(await page.locator('[data-assistant]').isVisible(), false);
  assert.equal(await page.locator('[data-play-store]').isVisible(), false);
  assert.equal(await page.locator('a[href*="travelchain"]').count(), 0);
  await page.screenshot({path: '/private/tmp/travelcrew-web-desktop.png', fullPage: true});
  for (const path of ['/', '/privacypolicy', '/terms&conditions', '/travelchain', '/about-us', '/not-a-page']) {
    await page.setViewportSize({width: 390, height: 844});
    const response = await page.goto(base + path);
    assert.equal(response.status(), path === '/not-a-page' ? 404 : 200, path);
    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    assert.equal(await page.getByRole('navigation', {name: 'Main navigation'}).isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', {name: 'Menu', exact: true}).getAttribute('aria-expanded'), 'false');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Mobile overflow: ${path}`);
    assert.equal(await page.getByRole('link', {name: 'Support@kaitechcorp.com', exact: true}).last().getAttribute('href'), 'mailto:Support@kaitechcorp.com');
  }
  await page.goto(base);
  await page.screenshot({path: '/private/tmp/travelcrew-web-mobile.png', fullPage: true});
  // A deployed assistant URL deliberately controls launch visibility.
  process.env.VITE_ASSISTANT_BASE_URL = 'https://travelcrew.app/assistant';
  await page.goto(base);
  assert.equal(await page.locator('[data-assistant]').isVisible(), true);
  assert.equal(await page.locator('#manage-assistants').getAttribute('href'), 'https://travelcrew.app/assistant/connect');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', {name: 'Copy connection URL'}).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://travelcrew.app/mcp');
  process.env.VITE_ASSISTANT_BASE_URL = '';
  await page.route('**/api/shared-trip?*', (route) => route.fulfill({json: {
    trip: {id: tripId, title: 'Example itinerary', destination: 'Tokyo', country: 'Japan', tripStatus: 'upcoming', tripStartDate: '2020-04-10', tripEndDate: '2020-04-12', images: [], createdBy: 'owner', isPrivate: true},
    members: [{uid: 'owner', displayName: '<script>unsafe</script>'}], flights: [],
    activities: [{id: 'museum', title: 'Museum', startDateTime: '2020-04-10T10:00:00+09:00', endDateTime: '2020-04-10T11:00:00+09:00'}, {id: 'unscheduled', title: 'Unscheduled'}],
  }}));
  await page.goto(`${base}/trip/${tripId}`);
  await page.getByRole('heading', {name: 'Tokyo', exact: true}).waitFor();
  assert.equal(await page.locator('#open-in-app-btn').getAttribute('href'), `travelcrew://trips/${tripId}`);
  assert.equal(await page.getByText('Past', {exact: true}).isVisible(), true);
  assert.equal(await page.getByText('<script>unsafe</script>', {exact: true}).isVisible(), true);
  assert.match(await page.locator('.activity-time').textContent(), /\d:\d{2}/);
  assert.equal(await page.locator('#lodging-section').isVisible(), false);
  assert.equal(await page.locator('#transportation-section').isVisible(), false);
  assert.equal(await page.getByText('🔒 Private trip', {exact: true}).isVisible(), true);
  assert.match(await page.locator('.trip-owner').textContent(), /Created by <script>unsafe<\/script>/);
  assert.equal(await page.getByRole('link', {name: 'Add to Calendar'}).getAttribute('href'), `/api/shared-trip?tripId=${tripId}&format=ics`);
  assert.equal(await page.getByRole('link', {name: 'Add Museum to calendar', exact: true}).getAttribute('href'), `/api/shared-trip?tripId=${tripId}&format=ics&activityId=museum`);
  assert.equal(await page.locator('.activity-card').filter({hasText: 'Unscheduled'}).getByRole('link').count(), 0);
  assert.equal(await page.getByText('Set a start date and time in the app to add this activity to your calendar.').isVisible(), true);
  await page.screenshot({path: '/private/tmp/travelcrew-shared-trip.png', fullPage: true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.unroute('**/api/shared-trip?*');
  await page.route('**/api/shared-trip?*', (route) => route.fulfill({json: {
    trip: {id: tripId, destination: 'Tokyo', createdBy: 'owner', isPrivate: false, tripStartDate: '2027-04-10'},
    members: [{uid: 'owner', displayName: 'Alex'}], activities: [],
    flights: [{displayName: 'Alex', flightNumber: 'TC123'}, {displayName: 'Blank', flightNumber: ' '}],
    lodgings: [
      {id: 'legacy', hotelName: 'First hotel', checkInDate: '2027-04-10', expensePerNight: 99},
      {id: 'second', hotelName: 'Second hotel', hotelAddress: 'Main Street', likesCount: 2},
      {id: 'blank', hotelName: ' '},
    ],
  }}));
  await page.goto(`${base}/trip/${tripId}`);
  await page.getByText('Second hotel', {exact: true}).waitFor();
  assert.equal(await page.locator('.lodging-card').count(), 2);
  assert.equal(await page.locator('.flight-card').count(), 1);
  assert.equal(await page.locator('#activities-section').isVisible(), false);
  assert.equal(await page.getByText('🌐 Public trip', {exact: true}).isVisible(), true);
  assert.equal(await page.getByText('2 likes', {exact: true}).isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({path: '/private/tmp/travelcrew-shared-lodging.png', fullPage: true});
  await page.unroute('**/api/shared-trip?*');
  await page.route('**/api/shared-trip?*', (route) => route.fulfill({json: {
    trip: {id: tripId, destination: 'Tokyo', createdBy: 'owner', tripStartDate: '2027-04-10'}, members: [], activities: [],
    transportation: [
      {id:'flight:one', mode:'flight', title:'Flight to Tokyo', origin:'Los Angeles', destination:'Tokyo Narita', departure:'2027-04-10T10:00:00-07:00', arrival:'2027-04-11T14:00:00+09:00', provider:'Example Air', serviceNumber:'TC123', travelerNames:['Randy','Alex']},
      {id:'transportation:ride', mode:'rideshare', displayName:'Randy', title:'Airport transfer', provider:'Uber', origin:'Narita Airport', destination:'Hotel', notes:'Meet at arrivals'},
      {id:'transportation:scooter', mode:'scooter', title:'Scooter rental', notes:'<script>unsafe</script>'},
      {id:'transportation:train', mode:'train', title:'Train excursion', departure:'2027-04-12'},
    ],
  }}));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({width, height:900});
    await page.goto(`${base}/trip/${tripId}`);
    await page.getByRole('heading', {name:'Transportation', exact:true}).waitFor();
    assert.equal(await page.locator('.flight-card').count(), 4);
    assert.equal(await page.getByText('Saved by Randy', {exact:true}).isVisible(), true);
    assert.equal(await page.locator('.flight-route').count(), 0);
    assert.equal(await page.getByRole('heading', {name:'Flight to Tokyo', exact:true}).count(), 0);
    assert.equal(await page.getByText('Notes not set', {exact:true}).count(), 0);
    assert.equal(await page.getByRole('heading', {name:'Scooter', exact:true}).isVisible(), true);
    assert.match(await page.locator('#transportation-section').textContent(), /10:00 AM/);
    assert.match(await page.locator('#transportation-section').textContent(), /2:00 PM/);
    assert.doesNotMatch(await page.locator('#transportation-section').textContent(), /UTC/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Transportation overflow at ${width}`);
    await page.locator('#transportation-section').screenshot({path:`/private/tmp/travelcrew-transportation-web-${width}.png`});
  }
  await page.unroute('**/api/shared-trip?*');
  await page.route('**/api/shared-trip?*', (route) => route.fulfill({status: 404, json: {error: 'Trip not found'}}));
  await page.goto(`${base}/trip/${tripId}`);
  await page.getByRole('heading', {name: 'Trip not found'}).waitFor();
  assert.equal(await page.locator('#cta-banner').isVisible(), false);
  assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
  console.log('Browser passed: desktop/mobile pages, navigation, current content, release-gated controls, app links, dates, and missing trips.');
} finally {
  delete process.env.VITE_ASSISTANT_BASE_URL;
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
