import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createWebServer} from '../server.mjs';
import {createAssistantProxy} from '../assistant-proxy.mjs';

test('MCP proxy preserves protocol, auth, cookies, methods and exact discovery routes', async (t) => {
  const seen = [];
  const backend = createServer(async (req, res) => {
    let body = '';
    try { for await (const chunk of req) body += chunk; }
    catch (error) { if (error.code === 'ECONNRESET') return; throw error; }
    seen.push({url: req.url, method: req.method, headers: req.headers, body});
    res.writeHead(401, {'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer resource_metadata="https://travelcrew.app/.well-known/oauth-protected-resource/mcp"', 'Set-Cookie': 'tc_consent=test; HttpOnly; Secure; SameSite=Lax; Path=/assistant/oauth/consent'});
    res.end(JSON.stringify({error: 'invalid_token'}));
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const web = createWebServer({assistantUpstream: `http://127.0.0.1:${backend.address().port}`});
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => web.close(resolve)); await new Promise((resolve) => backend.close(resolve)); });
  const origin = `http://127.0.0.1:${web.address().port}`;
  for (const path of ['/mcp', '/MCP/', '/assistant/oauth/consent?test=1', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server/assistant']) {
    const result = await fetch(origin + path, {method: 'POST', headers: {Authorization: 'Bearer test', Cookie: 'tc_consent=test', Origin: 'https://travelcrew.app', 'MCP-Protocol-Version': '2025-03-26', 'Content-Type': 'application/json', 'X-Forwarded-Host': 'evil.example'}, body: '{"id":1}'});
    assert.equal(result.status, 401); assert.match(result.headers.get('www-authenticate'), /resource_metadata/);
    assert.match(result.headers.get('set-cookie'), /HttpOnly/); assert.equal(result.headers.get('cache-control'), 'no-store');
    await result.text();
    const request = seen.at(-1); assert.equal(request.method, 'POST'); assert.equal(request.body, '{"id":1}');
    assert.equal(request.headers.authorization, 'Bearer test'); assert.equal(request.headers.cookie, 'tc_consent=test');
    assert.equal(request.headers['mcp-protocol-version'], '2025-03-26'); assert.equal(request.headers['x-forwarded-host'], undefined);
  }
  assert.equal(seen[1].url, '/mcp');
  assert.equal((await fetch(origin + '/api/shared-trip', {method: 'POST'})).status, 405);
  assert.equal(seen.length, 5);
  const large = await fetch(origin + '/mcp', {method: 'POST', body: 'x'.repeat(140000)});
  assert.equal(large.status, 413); await large.text();
});

test('unconfigured MCP fails closed and unsafe upstream origins are rejected', async (t) => {
  for (const url of ['https://example.com/path', 'https://user:pass@example.com', 'http://example.com', 'https://example.com?target=evil']) assert.throws(() => createAssistantProxy(url));
  const web = createWebServer({assistantUpstream: ''});
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => web.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${web.address().port}/mcp`, {method: 'POST'})).status, 503);
});
