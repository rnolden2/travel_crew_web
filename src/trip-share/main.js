import { fetchSharedTrip, fetchSharedTripSection } from './api.js';
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
    renderError(data?.error);
    return;
  }

  renderTrip(data);
  initRedirect(tripId);
  let revoked = false;
  const sections = ['transportation', 'lodgings', 'activities'];
  const targets = {transportation: 'transportation-section', lodgings: 'lodging-section',
    activities: 'activities-section'};
  for (const section of sections) {
    const anchor = document.getElementById(targets[section]);
    if (!anchor) continue;
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'section-load-more';
    control.textContent = `Load ${section}`;
    anchor.insertAdjacentElement('afterend', control);
    let source = 'nested';
    let cursor = null;
    let finished = false;
    let busy = false;
    const load = async () => {
      if (busy || finished || revoked) return;
      busy = true;
      control.disabled = true;
      control.textContent = `Loading ${section}…`;
      const result = await fetchSharedTripSection(tripId, section, source, cursor);
      busy = false;
      if (result.error === 'notFound') { revoked = true; renderError(); return; }
      if (revoked) return;
      if (result.error) {
        control.disabled = false;
        control.textContent = `Retry loading ${section}`;
        return;
      }
      data[section].push(...result.items);
      source = result.nextSource;
      cursor = result.nextCursor;
      finished = !source;
      renderTrip(data);
      control.hidden = finished;
      control.disabled = false;
      control.textContent = `Load more ${section}`;
      if (!finished && !result.items.length) await load();
    };
    control.addEventListener('click', load);
    load();
  }
}

init();
