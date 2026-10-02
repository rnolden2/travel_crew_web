import { config } from '../config.js';

const APP_SCHEME = config.appScheme;
export const validTripId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

export function tripAppLink(tripId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(tripId) || !/^[a-z][a-z0-9+.-]*$/.test(APP_SCHEME)) return null;
  return `${APP_SCHEME}://trips/${encodeURIComponent(tripId)}`;
}

export function initRedirect(tripId) {
  const openButton = document.getElementById('open-in-app-btn');
  if (!openButton) return;

  const deepLink = tripAppLink(tripId);
  if (!deepLink) { openButton.hidden = true; return; }
  openButton.href = deepLink;
}
