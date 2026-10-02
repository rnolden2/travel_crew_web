import { applyStoreLinks } from '../config.js';

function byId(id) {
  return document.getElementById(id);
}

function show(id) {
  byId(id)?.classList.remove('hidden');
}

function hide(id) {
  byId(id)?.classList.add('hidden');
}

function clear(element) {
  element.replaceChildren();
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null && text !== '') element.textContent = text;
  return element;
}

function appendText(parent, tag, className, text) {
  if (text == null || text === '') return null;
  const child = el(tag, className, text);
  parent.appendChild(child);
  return child;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (typeof value === 'object') {
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  }
  return null;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'});
}

function computeDaysToGo(value) {
  const start = toDate(value);
  if (!start || Number.isNaN(start.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  return Math.round((start - today) / 86400000);
}

function statusLabel(status, daysToGo, endDate) {
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  const end = toDate(endDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (end && end < today) return 'Past';
  if (daysToGo != null && daysToGo <= 0) return 'Active';
  if (daysToGo > 0) return `In ${daysToGo}d`;
  return 'Upcoming';
}

function setMeta(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.setAttribute('content', value);
}

function safeUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.origin === window.location.origin) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

function firstSafeUrl(values) {
  if (!Array.isArray(values)) return '';
  for (const value of values) {
    const url = safeUrl(value);
    if (url) return url;
  }
  return '';
}

function sectionHeading(text) {
  return el('h2', 'section-heading', text);
}

function metaItem(label, value) {
  if (!value) return null;
  const item = el('div', 'trip-meta-item');
  item.append(el('span', 'meta-label', label), el('span', 'meta-value', value));
  return item;
}

export function showLoading() {
  show('loading-state');
  hide('error-state');
  hide('trip-content');
  hide('cta-banner');
}

export function hideLoading() {
  hide('loading-state');
}

export function renderError() {
  hide('loading-state');
  hide('trip-content');
  hide('cta-banner');
  show('error-state');
  applyStoreLinks();
}

export function renderTrip({ trip, members = [], activities = [], flights = [] }) {
  updateMetaTags(trip);
  renderHero(trip);
  renderHeader(trip);
  renderMembers(members);
  renderFlights(flights);
  renderLodging(trip);
  renderActivities(activities);
  renderCTABanner();
  show('trip-content');
  show('cta-banner');
}

function updateMetaTags(trip) {
  const destination = trip.destination || trip.title || 'TravelCrew Trip';
  const title = `${destination} - TravelCrew`;
  const start = formatDate(trip.tripStartDate || trip.startDate);
  const end = formatDate(trip.tripEndDate || trip.endDate);
  const place = [trip.destination, trip.country].filter(Boolean).join(', ');
  const description = [place, [start, end].filter(Boolean).join(' - ')].filter(Boolean).join(' | ') || 'View this trip on TravelCrew.';
  const image = firstSafeUrl(trip.images);

  document.title = title;
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', title);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:image"]', image);
}

function renderHero(trip) {
  const hero = byId('trip-hero');
  if (!hero) return;
  hero.className = 'trip-hero';
  hero.style.backgroundImage = '';

  const image = firstSafeUrl(trip.images);
  if (image) {
    hero.style.backgroundImage = `url("${image}")`;
    hero.classList.add('has-image');
  } else {
    hero.classList.add('no-image');
  }
}

function renderHeader(trip) {
  const section = byId('trip-header');
  if (!section) return;
  clear(section);

  const startDate = formatDate(trip.tripStartDate || trip.startDate);
  const endDate = formatDate(trip.tripEndDate || trip.endDate);
  const daysToGo = computeDaysToGo(trip.tripStartDate || trip.startDate);
  const titleRow = el('div', 'trip-title-row');
  const badge = el('span', `trip-status-badge status-${trip.tripStatus || 'upcoming'}`, statusLabel(trip.tripStatus, daysToGo, trip.tripEndDate || trip.endDate));

  titleRow.append(el('h1', 'trip-destination', trip.destination || trip.title || 'Shared Trip'), badge);
  section.appendChild(titleRow);
  appendText(section, 'p', 'trip-country', [trip.country, trip.continent].filter(Boolean).join(' | '));
  if (trip.title && trip.title !== trip.destination) appendText(section, 'p', 'trip-tagline', trip.title);

  const metaRow = el('div', 'trip-meta-row');
  [
    metaItem('Dates', [startDate, endDate].filter(Boolean).join(' - ')),
    metaItem('Location', trip.tripLocation),
  ].filter(Boolean).forEach((item) => metaRow.appendChild(item));
  if (metaRow.children.length) section.appendChild(metaRow);

  if (daysToGo > 0) {
    appendText(section, 'p', 'days-to-go', `${daysToGo} day${daysToGo === 1 ? '' : 's'} to go`);
  }
}

function renderMembers(members) {
  const section = byId('members-section');
  if (!section) return;
  clear(section);
  if (!members.length) {
    hide('members-section');
    return;
  }

  const grid = el('div', 'members-grid');
  members.forEach((member) => {
    const card = el('div', 'member-card');
    const avatar = el('div', 'member-avatar');
    const image = safeUrl(member.profileImage);
    if (image) {
      avatar.style.backgroundImage = `url("${image}")`;
      avatar.setAttribute('aria-label', member.displayName || member.firstName || 'Traveler');
    } else {
      avatar.appendChild(el('span', '', (member.firstName?.[0] || member.displayName?.[0] || '?').toUpperCase()));
    }
    card.appendChild(avatar);
    appendText(card, 'p', 'member-name', member.displayName || member.firstName || 'Traveler');
    appendText(card, 'p', 'member-hometown', member.hometown);
    grid.appendChild(card);
  });

  section.append(sectionHeading('Travelers'), grid);
  show('members-section');
}

function renderFlights(flights) {
  const section = byId('flights-section');
  if (!section) return;
  clear(section);
  if (!flights.length) {
    hide('flights-section');
    return;
  }

  const list = el('div', 'flights-list');
  flights.forEach((flight) => {
    const card = el('div', 'flight-card');
    const header = el('div', 'flight-header');
    appendText(header, 'span', 'flight-traveler', flight.displayName || 'Traveler');
    appendText(header, 'span', 'flight-airline', flight.airlineName);
    appendText(header, 'span', 'flight-number', flight.flightNumber);

    const route = el('div', 'flight-route');
    route.append(el('span', 'airport', flight.departureAirport || '-'), el('span', 'flight-arrow', 'to'), el('span', 'airport', flight.arrivalAirport || '-'));

    const dates = el('div', 'flight-dates');
    appendText(dates, 'span', '', flight.departureDate ? `Dep: ${formatDate(flight.departureDate)}` : '');
    appendText(dates, 'span', '', flight.arrivalDate ? `Arr: ${formatDate(flight.arrivalDate)}` : '');

    card.append(header, route);
    if (dates.children.length) card.appendChild(dates);
    list.appendChild(card);
  });

  section.append(sectionHeading('Flights'), list);
  show('flights-section');
}

function renderLodging(trip) {
  const section = byId('lodging-section');
  if (!section) return;
  clear(section);

  const hasLodging = trip.lodgingType || trip.hotelName || trip.hotelAddress || trip.checkInDate || trip.checkOutDate;
  if (!hasLodging) {
    hide('lodging-section');
    return;
  }

  const card = el('div', 'lodging-card');
  appendText(card, 'p', 'lodging-type', trip.lodgingType);
  appendText(card, 'p', 'lodging-name', trip.hotelName);
  appendText(card, 'p', 'lodging-address', trip.hotelAddress);

  const dates = [trip.checkInDate ? `Check-in: ${formatDate(trip.checkInDate)}` : '', trip.checkOutDate ? `Check-out: ${formatDate(trip.checkOutDate)}` : ''].filter(Boolean);
  appendText(card, 'p', 'lodging-dates', dates.join(' | '));

  section.append(sectionHeading('Lodging'), card);
  show('lodging-section');
}

function renderActivities(activities) {
  const section = byId('activities-section');
  if (!section) return;
  clear(section);
  if (!activities.length) {
    hide('activities-section');
    return;
  }

  const list = el('div', 'activities-list');
  [...activities].sort((a, b) => (toDate(a.startDateTime)?.getTime() || Infinity) - (toDate(b.startDateTime)?.getTime() || Infinity)).forEach((activity) => {
    const card = el('div', 'activity-card');
    const header = el('div', 'activity-header');
    header.appendChild(el('h3', 'activity-title', activity.title || 'Activity'));
    if (activity.likesCount > 0) header.appendChild(el('span', 'activity-likes', `${activity.likesCount} likes`));

    const meta = el('div', 'activity-meta');
    appendText(meta, 'span', 'activity-location', activity.location);
    appendText(meta, 'span', 'activity-time', [formatDateTime(activity.startDateTime), formatDateTime(activity.endDateTime)].filter(Boolean).join(' – '));

    card.appendChild(header);
    appendText(card, 'p', 'activity-desc', activity.description);
    if (meta.children.length) card.appendChild(meta);
    list.appendChild(card);
  });

  section.append(sectionHeading(`Activities (${activities.length})`), list);
  show('activities-section');
}

function renderCTABanner() {
  applyStoreLinks();
}
