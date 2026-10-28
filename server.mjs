import {sortTransportation, transportModes} from './src/trip-share/transportation.js';
import {tripCalendar, activityCalendar} from './src/trip-share/calendar.js';
import {hasLodging} from './src/trip-share/sections.js';
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { createRateLimiter, clientKey, rateLimitFromEnv } from "./rate-limit.mjs";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldPath, Timestamp } from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {createAssistantProxy, isAssistantPath} from './assistant-proxy.mjs';

const port = Number(process.env.PORT || 8080);
const distDir = fileURLToPath(new URL("./dist", import.meta.url));
const firestoreDatabaseId =
  process.env.FIRESTORE_DATABASE_ID || "travel-crew-db-2";
const googlePlacesApiKey =
  process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

function getDatabase() {
  const adminApp = getApps().length ? getApps()[0] : initializeApp();
  return getFirestore(adminApp, firestoreDatabaseId);
}

const collections = {
  trips: "trips",
  activity: "activity",
  members: "members",
  activities: "activities",
  publicProfile: "publicProfile",
};

const pageRoutes = new Map([
  ["/", "/pages/index.html"],
  ["/travelchain", "/pages/travelchain.html"],
  ["/travelchain.html", "/pages/travelchain.html"],
  ["/privacypolicy", "/pages/privacypolicy.html"],
  ["/privacypolicy.html", "/pages/privacypolicy.html"],
  ["/terms&conditions", "/pages/terms&conditions.html"],
  ["/terms&conditions.html", "/pages/terms&conditions.html"],
]);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const runtimeConfigKeys = [
  "VITE_APP_STORE_URL",
  "VITE_PLAY_STORE_URL",
  "VITE_APP_SCHEME",
  "VITE_ASSISTANT_BASE_URL",
  "VITE_ASSISTANT_MCP_URL",
];

function sendRuntimeConfig(response) {
  const runtimeConfig = Object.fromEntries(
    runtimeConfigKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
  );

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/javascript; charset=utf-8",
  });
  response.end(
    `window.__TRAVEL_CREW_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
  );
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function serializeValue(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeValue(child)]),
    );
  }
  return value ?? null;
}

function getString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function getNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isPlacesPhotoName(value) {
  return (
    typeof value === "string" && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(value)
  );
}

function placePhotoProxyUrl(photoName, tripId, maxWidthPx = 1200) {
  if (!isPlacesPhotoName(photoName) || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) return "";
  const params = new URLSearchParams({
    tripId,
    name: photoName,
    maxWidthPx: String(maxWidthPx),
  });
  return `/api/place-photo?${params.toString()}`;
}

function placesPhotoName(value) {
  if (isPlacesPhotoName(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.port && !url.username && !url.password &&
        ["travelcrew.app", "www.travelcrew.app",
          "travel-crew-web-101337609697.us-central1.run.app"].includes(url.hostname) &&
        url.pathname === "/api/place-photo") {
      const name = url.searchParams.get("name");
      return isPlacesPhotoName(name) ? name : null;
    }
    if (url.hostname !== "places.googleapis.com") return null;
    const match = url.pathname.match(/^\/v1\/(places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+)\/media$/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function firebaseStorageObject(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" ||
        url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match || url.searchParams.get("alt") !== "media") return null;
    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    const token = url.searchParams.get("token");
    if (!/^[A-Za-z0-9._-]{3,255}$/.test(bucket) ||
        !path || path.length > 1024 || path.includes("\0") ||
        !token || token.length > 256 ||
        path.split("/").some((segment) => segment === "." || segment === "..")) return null;
    return {bucket, path, token};
  } catch {
    return null;
  }
}

function privateStorageObject(value, bucketName, {kind, ownerId, tripId} = {}) {
  if (typeof value !== "string" || !value.startsWith("gs://")) return null;
  const prefix = `gs://${bucketName}/`;
  if (!value.startsWith(prefix)) return null;
  const path = value.slice(prefix.length);
  if (!path || path.length > 1024 || path.includes("\\") || path.includes("?") ||
      path.includes("#") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const parts = path.split("/");
  if (kind === "trip" && parts.length === 5 && parts[0] === "private_uploads" &&
      parts[1] === ownerId && parts[2] === "trip_images" && parts[3] === tripId &&
      /^[A-Za-z0-9._-]{1,255}$/.test(parts[4])) return {bucket: bucketName, path};
  if (kind === "profile" && parts.length === 4 && parts[0] === "private_uploads" &&
      parts[1] === ownerId && parts[2] === "users_profile" &&
      /^[A-Za-z0-9._-]{1,255}$/.test(parts[3])) return {bucket: bucketName, path};
  return null;
}

function legacyPlacePhoto(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "maps.googleapis.com" ||
        url.port || url.username || url.password ||
        url.pathname !== "/maps/api/place/photo") return null;
    const reference = url.searchParams.get("photo_reference") ||
      url.searchParams.get("photoreference");
    const width = Number(url.searchParams.get("maxwidth"));
    if (!reference || !/^[A-Za-z0-9_-]{1,2048}$/.test(reference) ||
        !Number.isInteger(width) || width < 1 || width > 1600) return null;
    return {reference, width};
  } catch {
    return null;
  }
}

function normalizeTripImageUrl(value, tripId, imageIndex) {
  const image = getString(value);
  if (!image) return null;
  const photoName = placesPhotoName(image);
  if (photoName) {
    let width = 1200;
    try { width = new URL(image).searchParams.get("maxWidthPx") || 1200; } catch { /* Stored name only. */ }
    return placePhotoProxyUrl(photoName, tripId, width);
  }

  if (firebaseStorageObject(image) || image.startsWith("gs://")) {
    const params = new URLSearchParams({tripId, index: String(imageIndex)});
    return `/api/trip-photo?${params.toString()}`;
  }

  if (legacyPlacePhoto(image)) {
    const params = new URLSearchParams({tripId, index: String(imageIndex)});
    return `/api/legacy-place-photo?${params.toString()}`;
  }

  try {
    const url = new URL(image);
    if (url.hostname === "places.googleapis.com" ||
        url.hostname === "maps.googleapis.com" ||
        url.hostname === "firebasestorage.googleapis.com") {
      return null;
    }
  } catch {
    return image;
  }

  return image;
}

function sanitizeProfile(profile, profileImage = getString(profile.profileImage)) {
  return {
    displayName: getString(profile.displayName) || getString(profile.firstName),
    profileImage,
  };
}

function sharedProfileImageUrl(value, tripId, index) {
  const image = getString(value);
  if (!image) return null;
  if (firebaseStorageObject(image) || image.startsWith("gs://")) {
    return `/api/profile-photo?${new URLSearchParams({tripId, index: String(index)})}`;
  }
  // Malformed Storage URLs must never leak a token through the public JSON.
  try {
    if (new URL(image).hostname === "firebasestorage.googleapis.com") return null;
  } catch { return null; }
  return image;
}

function sanitizeActivity(id, activity) {
  return {
    id,
    title: getString(activity.title),
    description: getString(activity.description),
    location: getString(activity.location),
    startDateTime: serializeValue(activity.startDateTime),
    endDateTime: serializeValue(activity.endDateTime),
    likesCount: getNumber(activity.likesCount) ?? 0,
  };
}

function sanitizeTransportation(id, entry) {
  return {
    id,
    mode: Object.hasOwn(transportModes, entry.mode) ? entry.mode : 'other',
    displayName: getString(entry.displayName),
    departure: serializeValue(entry.departure),
    arrival: serializeValue(entry.arrival),
    notes: getString(entry.notes),
  };
}

function sanitizeLodging(id, lodging) {
  return {
    id,
    lodgingType: getString(lodging.lodgingType),
    hotelName: getString(lodging.hotelName),
    hotelAddress: getString(lodging.hotelAddress),
    checkInDate: serializeValue(lodging.checkInDate),
    checkOutDate: serializeValue(lodging.checkOutDate),
    expensePerNight: getNumber(lodging.expensePerNight),
    currencyCode: getString(lodging.currencyCode) ||
      (id === 'legacy' ? getString(lodging.lodgingCurrencyCode) : null),
  };
}

function sanitizeTrip(id, trip) {
  return {
    id,
    destination: getString(trip.destination),
    title: getString(trip.title),
    country: getString(trip.country),
    continent: getString(trip.continent),
    tripStatus: getString(trip.tripStatus),
    isPrivate: trip.isPrivate === true,
    tripStartDate: serializeValue(trip.tripStartDate),
    tripEndDate: serializeValue(trip.tripEndDate),
    startDate: serializeValue(trip.startDate),
    endDate: serializeValue(trip.endDate),
    daysToGo: getNumber(trip.daysToGo),
    tripLocation: getString(trip.tripLocation),
    latitude: getNumber(trip.latitude),
    longitude: getNumber(trip.longitude),
    images: (Array.isArray(trip.images) ? trip.images : [])
      .map((image, index) => normalizeTripImageUrl(image, id, index))
      .filter(Boolean),
    lodgingType: getString(trip.lodgingType),
    hotelName: getString(trip.hotelName),
    hotelAddress: getString(trip.hotelAddress),
    checkInDate: serializeValue(trip.checkInDate),
    checkOutDate: serializeValue(trip.checkOutDate),
    lodgingCurrencyCode: getString(trip.lodgingCurrencyCode),
  };
}

async function fetchNestedOrLegacyDocs({
  db,
  tripId,
  nestedCollection,
  legacyCollection,
}) {
  const nestedDocs = await readCollectionPages(db
    .collection(collections.trips)
    .doc(tripId)
    .collection(nestedCollection)
    .orderBy(FieldPath.documentId()));

  const legacyDocs = await readCollectionPages(db
    .collection(legacyCollection)
    .where("tripId", "==", tripId)
    .orderBy(FieldPath.documentId()));
  const nestedIds = new Set(nestedDocs.map((doc) => doc.id));
  const candidates = legacyDocs.filter((doc) => !nestedIds.has(doc.id));
  // A canonical tombstone beyond the first page still masks its old record.
  const canonicalMatches = [];
  for (let index = 0; index < candidates.length; index += 100) {
    const refs = candidates.slice(index, index + 100).map((doc) => db
      .collection(collections.trips).doc(tripId).collection(nestedCollection)
      .doc(doc.id));
    canonicalMatches.push(...await db.getAll(...refs));
  }
  return [...nestedDocs,
    ...candidates.filter((_, index) => !canonicalMatches[index].exists)];
}

async function readCollectionPages(query, maxDocs = 2000) {
  const docs = [];
  let cursor;
  while (true) {
    const remaining = maxDocs + 1 - docs.length;
    let pageQuery = query.limit(Math.min(100, remaining));
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();
    docs.push(...page.docs);
    if (docs.length > maxDocs) {
      const error = new Error("Shared trip collection exceeds display limit");
      error.code = "resource-exhausted";
      throw error;
    }
    if (page.docs.length < Math.min(100, remaining)) return docs;
    cursor = page.docs.at(-1);
  }
}

async function sharedTripUserIds(tripId, trip, ownerId, db, membersSnap) {
  const snapshot = membersSnap || await db.collection(collections.trips).doc(tripId)
    .collection(collections.members).limit(101).get();
  if (snapshot.docs.length > 100) {
    const error = new Error("Shared trip roster exceeds display limit");
    error.code = "resource-exhausted";
    throw error;
  }
  const members = new Map(snapshot.docs.map((doc) =>
    [getString(doc.data().userId) || doc.id, doc.data()]));
  const userIds = uniqueStrings([ownerId, ...members.keys(), ...getStringArray(trip.joinedUsers)])
    .filter((uid) => /^[A-Za-z0-9_-]{1,128}$/.test(uid) &&
      (!members.get(uid)?.status || members.get(uid).status === "active"));
  if (userIds.length > 100) {
    const error = new Error("Shared trip roster exceeds display limit");
    error.code = "resource-exhausted";
    throw error;
  }
  return userIds;
}

async function loadSharedBase(tripId, db) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) return null;
  const tripDoc = await db.collection(collections.trips).doc(tripId).get();
  if (!tripDoc.exists) return null;

  const trip = tripDoc.data();
  if (trip?.isShared !== true || trip.tripStatus === "deleted" || trip.moderationRemoved) return null;
  const ownerId = getString(trip.createdBy);
  if (!ownerId || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) return null;
  const [ownerAccount, ownerSafety] = await Promise.all([
    db.collection("users").doc(ownerId).get(), db.collection("safetyAccounts").doc(ownerId).get(),
  ]);
  if (!ownerAccount.exists || ownerAccount.data()?.isDeleted || ownerSafety.data()?.restricted) return null;

  const membersSnap = await db.collection(collections.trips).doc(tripId)
    .collection(collections.members).limit(101).get();

  // Explicit departures override historical joinedUsers arrays.
  const userIds = await sharedTripUserIds(tripId, trip, ownerId, db, membersSnap);
  const profiles = await Promise.all(userIds.map(async (uid, index) => {
    const [profile, account, safety] = await Promise.all([
      db.collection(collections.publicProfile).doc(uid).get(), db.collection("users").doc(uid).get(), db.collection("safetyAccounts").doc(uid).get(),
    ]);
    if (!account.exists || account.data()?.isDeleted || safety.data()?.restricted ||
        profile.data()?.moderationRemoved) return null;
    return {uid, index, profile};
  }));
  const visibleUsers = new Set(profiles.filter(Boolean).map((item) => item.uid));
  const ownerProfile = profiles.find((item) => item?.uid === ownerId)?.profile;
  const publicTrip = sanitizeTrip(tripDoc.id, trip);
  const base = {tripId, trip, ownerId, publicTrip, visibleUsers, rosterUserIds: userIds};
  if (!await sharedBaseCurrent(base, db)) return null;
  return {...base, response: {
    trip: {...publicTrip, creatorDisplayName: ownerProfile?.exists ?
      sanitizeProfile(ownerProfile.data()).displayName : null},
    members: profiles.filter((item) => item?.profile.exists)
      .map(({profile, index}) => sanitizeProfile(profile.data(),
        sharedProfileImageUrl(profile.data().profileImage, tripId, index))),
  }};
}

async function sharedBaseCurrent({tripId, trip, ownerId, publicTrip, rosterUserIds}, db) {
  // A share link can be revoked while its nested documents are loading.
  const [currentTrip, currentOwner, currentSafety, currentMembers] = await Promise.all([
    db.collection(collections.trips).doc(tripId).get(),
    db.collection("users").doc(ownerId).get(),
    db.collection("safetyAccounts").doc(ownerId).get(),
    db.collection(collections.trips).doc(tripId)
      .collection(collections.members).limit(101).get(),
  ]);
  if (!currentTrip.exists || currentTrip.data()?.isShared !== true ||
      currentTrip.data()?.tripStatus === "deleted" ||
      currentTrip.data()?.moderationRemoved ||
      currentTrip.data()?.createdBy !== ownerId ||
      !currentOwner.exists || currentOwner.data()?.isDeleted ||
      currentSafety.data()?.restricted ||
      JSON.stringify(sanitizeTrip(tripId, currentTrip.data())) !== JSON.stringify(publicTrip) ||
      JSON.stringify(currentTrip.data()?.images) !== JSON.stringify(trip.images) ||
      JSON.stringify(sanitizeLodging('legacy', currentTrip.data())) !==
        JSON.stringify(sanitizeLodging('legacy', trip)) ||
      JSON.stringify(getStringArray(currentTrip.data()?.joinedUsers)) !==
        JSON.stringify(getStringArray(trip.joinedUsers))) return false;
  const currentIds = await sharedTripUserIds(tripId, currentTrip.data(), ownerId, db, currentMembers);
  if (JSON.stringify(currentIds) !== JSON.stringify(rosterUserIds)) return false;
  return true;
}

async function lodgingLikesCount(tripId, lodgingId, visibleUsers, db) {
  const refs = [...visibleUsers].map((uid) => db.collection(collections.trips).doc(tripId)
    .collection('lodgings').doc(lodgingId).collection('likes').doc(uid));
  if (!refs.length) return 0;
  const snapshots = await db.getAll(...refs);
  return snapshots.filter((snapshot) => snapshot.exists).length;
}

export async function fetchSharedTripData(tripId, db = getDatabase()) {
  const base = await loadSharedBase(tripId, db);
  if (!base) return null;
  const {trip, visibleUsers} = base;
  const [activitiesDocs, lodgingsSnap, transportationSnap] = await Promise.all([
    fetchNestedOrLegacyDocs({
      db, tripId, nestedCollection: collections.activities,
      legacyCollection: collections.activity,
    }),
    readCollectionPages(db.collection(collections.trips).doc(tripId)
      .collection("lodgings").orderBy(FieldPath.documentId())),
    readCollectionPages(db.collection(collections.trips).doc(tripId)
      .collection("transportation").orderBy(FieldPath.documentId())),
  ]);
  const legacy = sanitizeLodging('legacy', trip);
  const lodgings = [
    ...(hasLodging(legacy) ? [legacy] : []),
    ...lodgingsSnap.filter((doc) => !doc.data().moderationRemoved && !doc.data().isDeleted)
      .map((doc) => sanitizeLodging(doc.id, doc.data())).filter(hasLodging),
  ];
  for (let index = 0; index < lodgings.length; index += 20) {
    await Promise.all(lodgings.slice(index, index + 20).map(async (lodging) => {
      lodging.likesCount = await lodgingLikesCount(tripId, lodging.id, visibleUsers, db);
    }));
  }
  const transportation = transportationSnap
    .filter((doc) => !doc.data().moderationRemoved && !doc.data().isDeleted && visibleUsers.has(doc.data().userId))
    .map((doc) => sanitizeTransportation(doc.id, doc.data()));
  if (!await sharedBaseCurrent(base, db)) return null;
  return {
    ...base.response,
    activities: activitiesDocs.filter((doc) => !doc.data().moderationRemoved && !doc.data().isDeleted).map((doc) =>
      sanitizeActivity(doc.id, doc.data()),
    ),
    lodgings,
    transportation: sortTransportation(transportation),
  };
}

const sharedSectionNames = new Set(['activities', 'lodgings', 'transportation']);
const sharedSectionPageSize = 50;

async function fetchSharedTripSection(tripId, section, source, cursor, db) {
  const base = await loadSharedBase(tripId, db);
  if (!base) return null;
  const legacy = section === 'activities' && source === 'legacy';
  let query = legacy ? db.collection(collections.activity).where('tripId', '==', tripId) :
    db.collection(collections.trips).doc(tripId).collection(section);
  query = query.orderBy(FieldPath.documentId());
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(sharedSectionPageSize + 1).get();
  const docs = snapshot.docs.slice(0, sharedSectionPageSize);
  const hasMore = snapshot.docs.length > sharedSectionPageSize;
  let items;
  if (section === 'activities') {
    let visible = docs;
    if (legacy && docs.length) {
      const canonical = await db.getAll(...docs.map((doc) => db.collection(collections.trips)
        .doc(tripId).collection(collections.activities).doc(doc.id)));
      visible = docs.filter((_, index) => !canonical[index].exists);
    }
    items = visible.filter((doc) => !doc.data().moderationRemoved && !doc.data().isDeleted)
      .map((doc) => sanitizeActivity(doc.id, doc.data()));
  } else if (section === 'transportation') {
    items = docs.filter((doc) => !doc.data().moderationRemoved && !doc.data().isDeleted &&
      base.visibleUsers.has(doc.data().userId))
      .map((doc) => sanitizeTransportation(doc.id, doc.data()));
  } else {
    items = docs.filter((doc) => !doc.data().moderationRemoved && !doc.data().isDeleted)
      .map((doc) => sanitizeLodging(doc.id, doc.data())).filter(hasLodging);
    if (!cursor) {
      const legacyLodging = sanitizeLodging('legacy', base.trip);
      if (hasLodging(legacyLodging)) items.unshift(legacyLodging);
    }
    for (let index = 0; index < items.length; index += 20) {
      await Promise.all(items.slice(index, index + 20).map(async (lodging) => {
        lodging.likesCount = await lodgingLikesCount(tripId, lodging.id, base.visibleUsers, db);
      }));
    }
  }
  if (!await sharedBaseCurrent(base, db)) return null;
  return {
    items,
    nextCursor: hasMore ? docs.at(-1).id : null,
    nextSource: hasMore ? (legacy ? 'legacy' : 'nested') :
      (section === 'activities' && !legacy ? 'legacy' : null),
  };
}

async function findSharedActivity(tripId, activityId, db) {
  const nested = await db.collection(collections.trips).doc(tripId)
    .collection(collections.activities).doc(activityId).get();
  const doc = nested.exists ? nested : await db.collection(collections.activity).doc(activityId).get();
  if (!doc.exists || doc.data().moderationRemoved || doc.data().isDeleted ||
      (!nested.exists && doc.data().tripId !== tripId)) return null;
  return sanitizeActivity(doc.id, doc.data());
}

async function handleSharedTripSectionApi(url, response, db) {
  const tripId = url.searchParams.get('tripId');
  const section = url.searchParams.get('section');
  const source = url.searchParams.get('source') || 'nested';
  const cursor = url.searchParams.get('cursor');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId || '') ||
      !sharedSectionNames.has(section) ||
      !['nested', 'legacy'].includes(source) ||
      (source === 'legacy' && section !== 'activities') ||
      (cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor))) {
    sendJson(response, 400, {error: 'Invalid section request'}); return;
  }
  try {
    const page = await fetchSharedTripSection(tripId, section, source, cursor, db);
    sendJson(response, page ? 200 : 404, page || {error: 'Trip not found'});
  } catch (error) {
    console.error('shared_trip_section_failed', {code: error.code || 'internal'});
    sendJson(response, error.code === 'resource-exhausted' ? 413 : 500,
      {error: 'Unable to load trip details'});
  }
}

async function handleSharedTripApi(url, response, db) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) {
    sendJson(response, 400, { error: "tripId required" });
    return;
  }

  const activityId = url.searchParams.get('activityId');
  if (activityId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(activityId)) {
    sendJson(response, 400, {error: 'Invalid activity ID'}); return;
  }
  try {
    const summary = url.searchParams.get('summary') === '1';
    const isCalendar = url.searchParams.get('format') === 'ics';
    const base = summary || isCalendar ? await loadSharedBase(tripId, db) : null;
    const data = base ? {...base.response, activities: [], lodgings: [], transportation: []} :
      summary || isCalendar ? null : await fetchSharedTripData(tripId, db);
    if (!data) {
      sendJson(response, 404, { error: "Trip not found" });
      return;
    }

    if (isCalendar) {
      const activity = activityId === null ? null : await findSharedActivity(tripId, activityId, db);
      if (activityId !== null && !activity) { sendJson(response, 404, {error: 'Activity not found'}); return; }
      const calendar = activity ? activityCalendar(tripId, activity) : tripCalendar(data.trip);
      if (!calendar) { sendJson(response, 422, {error: activity ? 'Activity times unavailable' : 'Trip dates unavailable'}); return; }
      if (!await sharedBaseCurrent(base, db)) { sendJson(response, 404, {error: 'Trip not found'}); return; }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="travelcrew-${tripId}${activityId === null ? '' : `-activity-${activityId}`}.ics"`,
      });
      response.end(calendar);
      return;
    }
    sendJson(response, 200, data);
  } catch (error) {
    console.error("shared_trip_failed", {code: error.code || "internal"});
    if (error.code === "resource-exhausted") {
      sendJson(response, 413, {error: "Trip has too many records for this preview"});
    } else {
      sendJson(response, 500, {error: "Unable to load shared trip"});
    }
  }
}

async function sharedTripForPhoto(tripId, db) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) return null;
  const tripDoc = await db.collection("trips").doc(tripId).get();
  const trip = tripDoc.data();
  if (!tripDoc.exists || trip.isShared !== true || trip.tripStatus === "deleted" ||
      trip.moderationRemoved) return null;
  const ownerId = getString(trip.createdBy);
  if (!ownerId || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) return null;
  const [owner, safety] = await Promise.all([
    db.collection("users").doc(ownerId).get(),
    db.collection("safetyAccounts").doc(ownerId).get(),
  ]);
  return owner.exists && owner.data()?.isDeleted !== true && safety.data()?.restricted !== true ? trip : null;
}

async function sharedPlacePhotoAllowed(tripId, photoName, db) {
  if (!isPlacesPhotoName(photoName)) return false;
  const trip = await sharedTripForPhoto(tripId, db);
  return !!trip && getStringArray(trip.images).some((image) => placesPhotoName(image) === photoName);
}

const maxPlacePhotoBytes = 20 * 1024 * 1024;
const placePhotoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const tripPhotoTypes = new Set([...placePhotoTypes, "image/heic", "image/heif"]);

async function boundedPhotoBytes(body) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxPlacePhotoBytes) throw new Error("Photo is too large");
    chunks.push(Buffer.from(chunk));
  }
  if (size === 0) throw new Error("Photo is empty");
  return Buffer.concat(chunks, size);
}

async function handlePlacePhotoApi(url, response, db, apiKey, fetchPhoto) {
  const tripId = url.searchParams.get("tripId") || "";
  const photoName = url.searchParams.get("name") || "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || !isPlacesPhotoName(photoName)) {
    sendJson(response, 400, { error: "Invalid photo request" });
    return;
  }
  const photoDb = db || getDatabase();
  try {
    if (!await sharedPlacePhotoAllowed(tripId, photoName, photoDb)) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
  } catch (error) {
    console.error("place_photo_authorization_failed", {code: error.code || "internal"});
    sendJson(response, 503, {error: "Photo unavailable"}); return;
  }
  if (!apiKey) {
    sendJson(response, 503, {error: "Place photo service unavailable"}); return;
  }

  const maxWidth = Number(url.searchParams.get("maxWidthPx") || 1200);
  const maxWidthPx = Number.isFinite(maxWidth)
    ? Math.min(Math.max(Math.round(maxWidth), 1), 4800)
    : 1200;
  const photoUrl = new URL(
    `https://places.googleapis.com/v1/${photoName}/media`,
  );
  photoUrl.searchParams.set("maxWidthPx", String(maxWidthPx));

  try {
    const photoResponse = await fetchPhoto(photoUrl, {headers: {"X-Goog-Api-Key": apiKey}, signal: AbortSignal.timeout(15000)});
    if (!photoResponse.ok || !photoResponse.body) {
      sendJson(response, photoResponse.status || 502, {
        error: "Unable to load place photo",
      });
      return;
    }

    const contentType = photoResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!placePhotoTypes.has(contentType) ||
        Number(photoResponse.headers.get("content-length")) > maxPlacePhotoBytes) {
      sendJson(response, 502, {error: "Unexpected photo response"}); return;
    }
    const bytes = await boundedPhotoBytes(photoResponse.body);
    if (!await sharedPlacePhotoAllowed(tripId, photoName, photoDb)) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    });
    response.end(bytes);
  } catch (error) {
    console.error("place_photo_failed", {name: error.name});
    sendJson(response, 502, { error: "Unable to load place photo" });
  }
}

async function handleLegacyPlacePhotoApi(url, response, db, apiKey, fetchPhoto) {
  const tripId = url.searchParams.get("tripId") || "";
  const rawIndex = url.searchParams.get("index") || "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || !/^(0|[1-9][0-9]{0,3})$/.test(rawIndex)) {
    sendJson(response, 400, {error: "Invalid photo request"}); return;
  }
  const index = Number(rawIndex);
  const photoDb = db || getDatabase();
  try {
    const trip = await sharedTripForPhoto(tripId, photoDb);
    const source = trip?.images?.[index];
    const photo = legacyPlacePhoto(source);
    if (!photo) { sendJson(response, 404, {error: "Photo unavailable"}); return; }
    if (!apiKey) { sendJson(response, 503, {error: "Photo service unavailable"}); return; }
    const upstream = new URL("https://maps.googleapis.com/maps/api/place/photo");
    upstream.searchParams.set("maxwidth", String(photo.width));
    upstream.searchParams.set("photo_reference", photo.reference);
    upstream.searchParams.set("key", apiKey);
    const signal = AbortSignal.timeout(15000);
    let imageUrl = upstream;
    let photoResponse;
    for (let redirects = 0; redirects <= 2; redirects++) {
      photoResponse = await fetchPhoto(imageUrl, {redirect: "manual", signal});
      if (![301, 302, 303, 307, 308].includes(photoResponse.status)) break;
      const location = photoResponse.headers.get("location");
      if (!location || redirects === 2) throw new Error("Unexpected photo redirect");
      const next = new URL(location, imageUrl);
      const trustedHost = next.hostname === "maps.googleapis.com" ||
        next.hostname.endsWith(".googleusercontent.com") ||
        next.hostname.endsWith(".gstatic.com");
      if (next.protocol !== "https:" || next.port || next.username ||
          next.password || !trustedHost) throw new Error("Unexpected photo redirect");
      imageUrl = next;
    }
    if (!photoResponse.ok || !photoResponse.body) {
      sendJson(response, 502, {error: "Photo unavailable"}); return;
    }
    const contentType = photoResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!placePhotoTypes.has(contentType) ||
        Number(photoResponse.headers.get("content-length")) > maxPlacePhotoBytes) {
      sendJson(response, 502, {error: "Unexpected photo response"}); return;
    }
    const bytes = await boundedPhotoBytes(photoResponse.body);
    const current = await sharedTripForPhoto(tripId, photoDb);
    if (!current || current.images?.[index] !== source) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    response.writeHead(200, {"Cache-Control": "no-store", "Content-Type": contentType});
    response.end(bytes);
  } catch (error) {
    console.error("legacy_place_photo_failed", {name: error.name});
    sendJson(response, 502, {error: "Photo unavailable"});
  }
}

async function handleTripPhotoApi(url, response, db, bucketName, providedBucket) {
  const tripId = url.searchParams.get("tripId") || "";
  const rawIndex = url.searchParams.get("index") || "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || !/^(0|[1-9][0-9]{0,3})$/.test(rawIndex)) {
    sendJson(response, 400, {error: "Invalid photo request"}); return;
  }
  const index = Number(rawIndex);
  const photoDb = db || getDatabase();
  try {
    const trip = await sharedTripForPhoto(tripId, photoDb);
    const source = trip?.images?.[index];
    const object = firebaseStorageObject(source) || privateStorageObject(source, bucketName,
      {kind: "trip", ownerId: getString(trip?.createdBy), tripId});
    if (!object || object.bucket !== bucketName) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    const bucket = providedBucket || getStorage().bucket(bucketName);
    const file = bucket.file(object.path);
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType?.split(";")[0].trim().toLowerCase();
    const size = Number(metadata.size);
    // The stored download token is proof that this trip already had access to
    // the object. Admin Storage reads must not become a way to fetch a guessed
    // private object merely by placing its path in a shared trip document.
    const tokens = metadata.metadata?.firebaseStorageDownloadTokens?.split(",") || [];
    if (object.token && !tokens.includes(object.token)) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    if (!tripPhotoTypes.has(contentType) || !Number.isFinite(size) ||
        size <= 0 || size > maxPlacePhotoBytes) {
      sendJson(response, 502, {error: "Unexpected photo response"}); return;
    }
    const bytes = await boundedPhotoBytes(file.createReadStream());
    const current = await sharedTripForPhoto(tripId, photoDb);
    if (!current || current.images?.[index] !== source) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    response.writeHead(200, {"Cache-Control": "no-store", "Content-Type": contentType});
    response.end(bytes);
  } catch (error) {
    console.error("trip_photo_failed", {code: error.code || "internal"});
    sendJson(response, error.code === 404 ? 404 : 502, {error: "Photo unavailable"});
  }
}

async function sharedProfilePhotoSource(tripId, index, db) {
  const trip = await sharedTripForPhoto(tripId, db);
  if (!trip) return null;
  const ownerId = getString(trip.createdBy);
  const userIds = await sharedTripUserIds(tripId, trip, ownerId, db);
  const uid = userIds[index];
  if (!uid) return null;
  const [profile, account, safety] = await Promise.all([
    db.collection(collections.publicProfile).doc(uid).get(),
    db.collection("users").doc(uid).get(),
    db.collection("safetyAccounts").doc(uid).get(),
  ]);
  if (!profile.exists || !account.exists || account.data()?.isDeleted ||
      safety.data()?.restricted || profile.data()?.moderationRemoved) return null;
  const source = getString(profile.data()?.profileImage);
  return source && (firebaseStorageObject(source) || source.startsWith("gs://")) ? {uid, source} : null;
}

async function handleProfilePhotoApi(url, response, db, bucketName, providedBucket) {
  const tripId = url.searchParams.get("tripId") || "";
  const rawIndex = url.searchParams.get("index") || "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || !/^(0|[1-9][0-9]{0,2})$/.test(rawIndex) ||
      Number(rawIndex) >= 100) {
    sendJson(response, 400, {error: "Invalid photo request"}); return;
  }
  const photoDb = db || getDatabase();
  try {
    const original = await sharedProfilePhotoSource(tripId, Number(rawIndex), photoDb);
    const object = firebaseStorageObject(original?.source) || privateStorageObject(original?.source,
      bucketName, {kind: "profile", ownerId: original?.uid});
    if (!object || object.bucket !== bucketName) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    const bucket = providedBucket || getStorage().bucket(bucketName);
    const file = bucket.file(object.path);
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType?.split(";")[0].trim().toLowerCase();
    const size = Number(metadata.size);
    const tokens = metadata.metadata?.firebaseStorageDownloadTokens?.split(",") || [];
    if (object.token && !tokens.includes(object.token)) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    if (!tripPhotoTypes.has(contentType) || !Number.isFinite(size) ||
        size <= 0 || size > maxPlacePhotoBytes) {
      sendJson(response, 502, {error: "Unexpected photo response"}); return;
    }
    const bytes = await boundedPhotoBytes(file.createReadStream());
    const current = await sharedProfilePhotoSource(tripId, Number(rawIndex), photoDb);
    if (!current || current.uid !== original.uid || current.source !== original.source) {
      sendJson(response, 404, {error: "Photo unavailable"}); return;
    }
    response.writeHead(200, {"Cache-Control": "no-store", "Content-Type": contentType});
    response.end(bytes);
  } catch (error) {
    console.error("profile_photo_failed", {code: error.code || "internal"});
    sendJson(response, error.code === 404 ? 404 : 502, {error: "Photo unavailable"});
  }
}

function resolveRoute(pathname) {
  if (pathname.startsWith("/trip/")) return "/pages/trip.html";
  return pageRoutes.get(pathname) || pathname;
}

function safeFilePath(routePath) {
  const normalizedPath = normalize(routePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(distDir, normalizedPath);
  if (!filePath.startsWith(`${distDir}${sep}`)) return null;
  return filePath;
}

function sendFile(response, filePath, statusCode = 200) {
  const extension = extname(filePath);
  const headers = {
    "Content-Type": contentTypes.get(extension) || "application/octet-stream",
  };

  if (extension === ".js" || extension === ".css") {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }

  response.writeHead(statusCode, headers);
  createReadStream(filePath).pipe(response);
}

export function createWebServer({database, assistantUpstream = process.env.ASSISTANT_UPSTREAM_URL,
  placePhotoApiKey = googlePlacesApiKey, fetchPlacePhoto = fetch,
  storageBucketName = process.env.FIREBASE_STORAGE_BUCKET, storageBucket,
  apiRateLimit = rateLimitFromEnv(), now} = {}) {
 const assistantProxy = createAssistantProxy(assistantUpstream);
 // 0 disables the per-instance brake; the assistant proxy has its own limits.
 const limiter = apiRateLimit?.limit > 0 ?
   createRateLimiter({limit: apiRateLimit.limit, windowMs: apiRateLimit.windowMs, now}) : null;
 return createServer((request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  const url = new URL(request.url || '/', 'http://localhost');
  if (isAssistantPath(url.pathname)) {
    if (assistantProxy) assistantProxy(request, response, url);
    else sendJson(response, 503, {error: 'not_configured', error_description: 'Assistant connections are not configured yet'});
    return;
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD");
    sendJson(response, 405, {error: "Method not allowed"}); return;
  }
  if (limiter && url.pathname.startsWith("/api/")) {
    const verdict = limiter.check(clientKey(request, apiRateLimit.trustedProxyHops));
    if (!verdict.allowed) {
      response.setHeader("Retry-After", String(verdict.retryAfterSeconds));
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 429, {error: "Too many requests"}); return;
    }
  }

  if (url.pathname === "/api/shared-trip") {
    handleSharedTripApi(url, response, database);
    return;
  }

  if (url.pathname === "/api/shared-trip-section") {
    handleSharedTripSectionApi(url, response, database);
    return;
  }

  if (url.pathname === "/api/place-photo") {
    handlePlacePhotoApi(url, response, database, placePhotoApiKey, fetchPlacePhoto);
    return;
  }

  if (url.pathname === "/api/legacy-place-photo") {
    handleLegacyPlacePhotoApi(url, response, database, placePhotoApiKey, fetchPlacePhoto);
    return;
  }

  if (url.pathname === "/api/trip-photo") {
    handleTripPhotoApi(url, response, database, storageBucketName, storageBucket);
    return;
  }

  if (url.pathname === "/api/profile-photo") {
    handleProfilePhotoApi(url, response, database, storageBucketName, storageBucket);
    return;
  }

  if (url.pathname === "/runtime-config.js") {
    sendRuntimeConfig(response);
    return;
  }
  if (url.pathname === '/.well-known/openai-apps-challenge' && process.env.OPENAI_APPS_CHALLENGE) {
    response.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(process.env.OPENAI_APPS_CHALLENGE);
    return;
  }
  if (url.pathname === "/about-us") {
    response.writeHead(302, {Location: "/#about"}); response.end(); return;
  }

  const routePath = resolveRoute(url.pathname);
  const filePath = safeFilePath(routePath);

  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(response, filePath);
    return;
  }

  const notFoundPath = join(distDir, "pages/404.html");
  if (existsSync(notFoundPath)) {
    sendFile(response, notFoundPath, 404);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 createWebServer().listen(port, "0.0.0.0", () => {
  console.log(`Travel Crew web server listening on port ${port}`);
 });
}
