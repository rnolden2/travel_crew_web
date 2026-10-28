// Fixed-window request limiter for the public API routes. State is per
// process; Cloud Run instances do not share it, so the limit is a per-instance
// abuse brake rather than a global quota.

export function createRateLimiter({limit = 240, windowMs = 60_000, maxClients = 20_000, now = Date.now} = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  if (!Number.isFinite(windowMs) || windowMs < 1000) throw new Error("windowMs must be at least 1000");
  const clients = new Map();
  const sweep = (time) => {
    for (const [key, entry] of clients) if (entry.resetAt <= time) clients.delete(key);
  };
  return {
    check(key) {
      const time = now();
      if (clients.size >= maxClients) {
        sweep(time);
        // Still full: drop the oldest window so memory stays bounded.
        if (clients.size >= maxClients) clients.delete(clients.keys().next().value);
      }
      let entry = clients.get(key);
      if (!entry || entry.resetAt <= time) {
        entry = {count: 0, resetAt: time + windowMs};
        clients.set(key, entry);
      }
      entry.count++;
      return {
        allowed: entry.count <= limit,
        remaining: Math.max(0, limit - entry.count),
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - time) / 1000)),
      };
    },
    size() { return clients.size; },
  };
}

// Google's front end appends the connecting address to X-Forwarded-For, so the
// trustworthy entry is counted from the end. Earlier entries are client supplied.
export function clientKey(request, trustedProxyHops = 1) {
  const hops = Number.isInteger(trustedProxyHops) && trustedProxyHops >= 1 ? trustedProxyHops : 1;
  const header = request.headers?.["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  const parts = typeof raw === "string" ? raw.split(",").map((part) => part.trim()).filter(Boolean) : [];
  const candidate = parts.length >= hops ? parts[parts.length - hops] : request.socket?.remoteAddress;
  return String(candidate || "unknown").slice(0, 64);
}

export function rateLimitFromEnv(env = process.env) {
  const limit = env.WEB_API_RATE_LIMIT_PER_MINUTE === undefined ? 240 : Number(env.WEB_API_RATE_LIMIT_PER_MINUTE);
  const hops = env.WEB_TRUSTED_PROXY_HOPS === undefined ? 1 : Number(env.WEB_TRUSTED_PROXY_HOPS);
  return {
    limit: Number.isInteger(limit) && limit >= 0 ? limit : 240,
    trustedProxyHops: Number.isInteger(hops) && hops >= 1 ? hops : 1,
  };
}
