import test from 'node:test';
import assert from 'node:assert/strict';
import {createRateLimiter, clientKey, rateLimitFromEnv} from '../rate-limit.mjs';
import {createWebServer} from '../server.mjs';

test('fixed window allows the limit, rejects the excess and resets after the window', () => {
  let time = 1_000_000;
  const limiter = createRateLimiter({limit: 2, windowMs: 60_000, now: () => time});
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  const third = limiter.check('a');
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSeconds, 60);
  assert.equal(limiter.check('b').allowed, true, 'other clients are independent');
  time += 60_000;
  assert.equal(limiter.check('a').allowed, true);
});

test('client table stays bounded under many distinct clients', () => {
  const limiter = createRateLimiter({limit: 1, maxClients: 3, now: () => 5_000_000});
  for (let index = 0; index < 10; index++) limiter.check(`client-${index}`);
  assert.ok(limiter.size() <= 3);
});

test('client key trusts only the proxy-appended forwarded address', () => {
  const socket = {remoteAddress: '10.0.0.9'};
  assert.equal(clientKey({headers: {}, socket}), '10.0.0.9');
  assert.equal(clientKey({headers: {'x-forwarded-for': '203.0.113.5'}, socket}), '203.0.113.5');
  assert.equal(clientKey({headers: {'x-forwarded-for': 'spoofed, 203.0.113.5'}, socket}), '203.0.113.5');
  assert.equal(clientKey({headers: {'x-forwarded-for': 'spoofed, 203.0.113.5, 35.1.1.1'}, socket}, 2), '203.0.113.5');
  assert.equal(clientKey({headers: {'x-forwarded-for': '203.0.113.5'}, socket}, 2), '10.0.0.9');
  assert.equal(clientKey({headers: {'x-forwarded-for': 'x'.repeat(200)}, socket}).length, 64);
  assert.equal(clientKey({headers: {}}), 'unknown');
});

test('environment parsing falls back to safe defaults', () => {
  assert.deepEqual(rateLimitFromEnv({}), {limit: 240, trustedProxyHops: 1});
  assert.deepEqual(rateLimitFromEnv({WEB_API_RATE_LIMIT_PER_MINUTE: '0'}), {limit: 0, trustedProxyHops: 1});
  assert.deepEqual(rateLimitFromEnv({WEB_API_RATE_LIMIT_PER_MINUTE: 'many', WEB_TRUSTED_PROXY_HOPS: '-3'}),
      {limit: 240, trustedProxyHops: 1});
  assert.deepEqual(rateLimitFromEnv({WEB_API_RATE_LIMIT_PER_MINUTE: '30', WEB_TRUSTED_PROXY_HOPS: '2'}),
      {limit: 30, trustedProxyHops: 2});
});

test('API routes answer 429 with Retry-After once a client exceeds the limit; pages are unaffected', async () => {
  const server = createWebServer({apiRateLimit: {limit: 2, trustedProxyHops: 1}});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const first = await fetch(base + '/api/place-photo');
    assert.equal(first.status, 400);
    assert.equal((await fetch(base + '/api/place-photo')).status, 400);
    const blocked = await fetch(base + '/api/place-photo');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await blocked.json(), {error: 'Too many requests'});
    const other = await fetch(base + '/api/place-photo', {headers: {'x-forwarded-for': '198.51.100.7'}});
    assert.equal(other.status, 400, 'a different forwarded client has its own window');
    const page = await fetch(base + '/about-us', {redirect: 'manual'});
    assert.equal(page.status, 302, 'non-API routes are not limited');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a zero limit disables the brake', async () => {
  const server = createWebServer({apiRateLimit: {limit: 0}});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let index = 0; index < 5; index++) assert.equal((await fetch(base + '/api/place-photo')).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
