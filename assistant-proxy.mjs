import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';

const discoveryPaths = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource/assistant/mcp',
  '/.well-known/oauth-authorization-server/assistant',
]);
export function isAssistantPath(path) {
  return /^\/mcp\/?$/i.test(path) || path === '/assistant' || path.startsWith('/assistant/') || discoveryPaths.has(path);
}

// Only a configured service origin can receive credentials. Never derive the
// upstream from Host, a query string, or a client-supplied forwarding header.
export function createAssistantProxy(origin) {
  if (!origin) return null;
  const upstream = new URL(origin);
  if (upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/' ||
      (upstream.protocol !== 'https:' && !(upstream.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(upstream.hostname)))) {
    throw new Error('ASSISTANT_UPSTREAM_URL must be an HTTPS origin (HTTP loopback allowed for tests)');
  }
  return (request, response, url) => {
    if (Number(request.headers['content-length']) > 131072) {
      response.writeHead(413, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      response.end(JSON.stringify({error: 'payload_too_large'}));
      request.resume();
      return;
    }
    const headers = {};
    for (const name of ['authorization', 'content-type', 'content-length', 'accept', 'origin', 'cookie', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id', 'idempotency-key']) {
      if (request.headers[name] !== undefined) headers[name] = request.headers[name];
    }
    if (request.headers['transfer-encoding']) headers['transfer-encoding'] = 'chunked';
    // Canonicalize case without redirects, which can drop POST bodies or auth.
    const path = /^\/mcp\/?$/i.test(url.pathname) ? '/mcp' : url.pathname;
    const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
    const proxy = send(upstream, {path: path + url.search, method: request.method, headers}, (result) => {
      const outgoing = {...result.headers};
      for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) delete outgoing[name];
      outgoing['cache-control'] = 'no-store';
      response.writeHead(result.statusCode, outgoing);
      result.on('error', () => response.destroy());
      result.pipe(response);
    });
    proxy.setTimeout(65000, () => proxy.destroy(new Error('Assistant upstream timeout')));
    proxy.on('error', () => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) return response.destroy();
      response.writeHead(502, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      response.end(JSON.stringify({error: 'assistant_unavailable', error_description: 'Please retry shortly using the same idempotency key.'}));
    });
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 131072) {
        if (!response.headersSent) {
          response.writeHead(413, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
          response.end(JSON.stringify({error: 'payload_too_large'}));
        }
        request.unpipe(proxy);
        proxy.destroy();
      }
    });
    request.on('aborted', () => proxy.destroy());
    response.on('close', () => { if (!response.writableEnded) proxy.destroy(); });
    request.pipe(proxy);
  };
}
