import { fetchSharedTrip } from './api.js';
import { initRedirect, validTripId } from './redirect.js';
import { hideLoading, renderError, renderTrip, showLoading } from './render.js';

function getTripIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'trip' && parts.length === 2) {
    try { const id = decodeURIComponent(parts[1]); return validTripId(id) ? id : null; }
    catch { return null; }
  }
  return null;
}

async function init() {
  const tripId = getTripIdFromPath();

  if (!tripId) {
    renderError();
    return;
  }

  showLoading();
  const data = await fetchSharedTrip(tripId);
  hideLoading();

  if (!data?.trip) {
    renderError();
    return;
  }

  renderTrip(data);
  initRedirect(tripId);
}

init();
