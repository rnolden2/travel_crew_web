import {transportModes, flightTransport, sortTransportation} from './transportation.js';
import {formatTravelTime} from './travel-time.js';
import {tripCalendar, activityCalendar} from './calendar.js';
import {hasLodging, hasFlight} from './sections.js';
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
  if (typeof value === 'string') return formatTravelTime(value, {dateOnly: true});
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  if (typeof value === 'string') return formatTravelTime(value);
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

export function renderTrip({ trip, members = [], activities = [], flights = [], lodgings, transportation }) {
  updateMetaTags(trip);
  renderHero(trip);
  renderHeader(trip, members);
  renderMembers(members);
  renderTransportation(transportation ?? flights.filter(hasFlight).map((flight) => flightTransport(flight)));
  renderLodging(lodgings ?? (hasLodging(trip) ? [trip] : []));
  renderActivities(activities, trip.id);
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

function renderHeader(trip, members) {
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

  const owner = members.find((member) => member.uid === trip.createdBy);
  appendText(section, 'p', 'trip-owner', `Created by ${owner?.displayName || owner?.firstName || 'Unavailable'}`);
  const privacy = el('span', 'trip-privacy', trip.isPrivate ? '🔒 Private trip' : '🌐 Public trip');
  section.appendChild(privacy);
  if (tripCalendar(trip)) {
    const calendar = el('a', 'calendar-button', 'Add to Calendar');
    calendar.href = `/api/shared-trip?tripId=${encodeURIComponent(trip.id)}&format=ics`;
    calendar.setAttribute('download', `travelcrew-${trip.id}.ics`);
    section.appendChild(calendar);
    appendText(section, 'p', 'calendar-hint', 'Download a calendar event for the trip dates.');
  }

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

function renderTransportation(entries) {
  const section = byId('transportation-section');
  clear(section);
  if (!entries.length) { hide('transportation-section'); return; }
  const list = el('div', 'flights-list');
  for (const entry of sortTransportation(entries)) {
    const card = el('div', 'flight-card');
    appendText(card, 'h3', '', transportModes[entry.mode] || 'Other');
    if (entry.displayName?.trim()) appendText(card, 'p', '', `Saved by ${entry.displayName.trim()}`);
    if (entry.departure) appendText(card, 'p', '', `Departure: ${formatDateTime(entry.departure)}`);
    if (entry.arrival) appendText(card, 'p', '', `Arrival: ${formatDateTime(entry.arrival)}`);
    if (!entry.departure && !entry.arrival) appendText(card, 'p', '', 'Time not set');
    appendText(card, 'p', 'transportation-notes', entry.notes);
    list.appendChild(card);
  }
  section.append(sectionHeading('Transportation'), list);
  show('transportation-section');
}

function renderLodging(lodgings) {
  const section = byId('lodging-section');
  if (!section) return;
  clear(section);
  const options = lodgings.filter(hasLodging);
  if (!options.length) { hide('lodging-section'); return; }
  section.append(sectionHeading('Lodging'));
  for (const option of options) {
    const card = el('div', 'lodging-card');
    appendText(card, 'p', 'lodging-type', option.lodgingType);
    appendText(card, 'p', 'lodging-name', option.hotelName);
    appendText(card, 'p', 'lodging-address', option.hotelAddress);
    const dates = [option.checkInDate ? `Check-in: ${formatDateTime(option.checkInDate)}` : '', option.checkOutDate ? `Check-out: ${formatDateTime(option.checkOutDate)}` : ''].filter(Boolean);
    appendText(card, 'p', 'lodging-dates', dates.join(' | '));
    if (option.expensePerNight != null) appendText(card, 'p', 'lodging-cost', `$${Number(option.expensePerNight).toFixed(2)} / night`);
    if (option.likesCount > 0) appendText(card, 'p', 'lodging-likes', `${option.likesCount} ${option.likesCount === 1 ? 'like' : 'likes'}`);
    section.append(card);
  }
  show('lodging-section');
}

function renderActivities(activities, tripId) {
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
    if (activity.id && activityCalendar(tripId, activity)) {
      const calendar = el('a', 'calendar-button activity-calendar', 'Add to Calendar');
      calendar.href = `/api/shared-trip?tripId=${encodeURIComponent(tripId)}&format=ics&activityId=${encodeURIComponent(activity.id)}`;
      calendar.setAttribute('download', `travelcrew-activity-${activity.id}.ics`);
      calendar.setAttribute('aria-label', `Add ${activity.title || 'activity'} to calendar`);
      card.appendChild(calendar);
      if (!activity.endDateTime) appendText(card, 'p', 'calendar-hint', 'No end time set; calendar event defaults to 1 hour.');
    } else {
      appendText(card, 'p', 'calendar-hint', activity.startDateTime ? 'Calendar export unavailable: check the activity times in the app.' : 'Set a start date and time in the app to add this activity to your calendar.');
    }
    list.appendChild(card);
  });

  section.append(sectionHeading(`Activities (${activities.length})`), list);
  show('activities-section');
}

function renderCTABanner() {
  applyStoreLinks();
}
