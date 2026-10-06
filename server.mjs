import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
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
  flights: "flights",
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

function placePhotoProxyUrl(photoName, maxWidthPx = 1200) {
  if (!isPlacesPhotoName(photoName)) return "";
  const params = new URLSearchParams({
    name: photoName,
    maxWidthPx: String(maxWidthPx),
  });
  return `/api/place-photo?${params.toString()}`;
}

function normalizeTripImageUrl(value) {
  const image = getString(value);
  if (!image) return null;
  if (isPlacesPhotoName(image)) return placePhotoProxyUrl(image);

  try {
    const url = new URL(image);
    if (url.hostname === "places.googleapis.com") {
      const match = url.pathname.match(
        /^\/v1\/(places\/[^/]+\/photos\/[^/]+)\/media$/,
      );
      if (match) {
        return placePhotoProxyUrl(
          match[1],
          url.searchParams.get("maxWidthPx") || 1200,
        );
      }
    }
  } catch {
    return image;
  }

  return image;
}

function sanitizeProfile(uid, profile) {
  return {
    uid,
    displayName: getString(profile.displayName),
    firstName: getString(profile.firstName),
    profileImage: getString(profile.profileImage),
    hometown: getString(profile.hometown),
  };
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

function sanitizeFlight(id, flight) {
  return {
    id,
    userId: getString(flight.userId),
    displayName: getString(flight.displayName),
    airlineName: getString(flight.airlineName),
    flightNumber: getString(flight.flightNumber),
    departureAirport: getString(flight.departureAirport),
    arrivalAirport: getString(flight.arrivalAirport),
    departureDate: serializeValue(flight.departureDate),
    arrivalDate: serializeValue(flight.arrivalDate),
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
    tripStartDate: serializeValue(trip.tripStartDate),
    tripEndDate: serializeValue(trip.tripEndDate),
    startDate: serializeValue(trip.startDate),
    endDate: serializeValue(trip.endDate),
    daysToGo: getNumber(trip.daysToGo),
    tripLocation: getString(trip.tripLocation),
    latitude: getNumber(trip.latitude),
    longitude: getNumber(trip.longitude),
    images: getStringArray(trip.images)
      .map(normalizeTripImageUrl)
      .filter(Boolean),
    airlineName: getString(trip.airlineName),
    flightNumber: getString(trip.flightNumber),
    departureAirport: getString(trip.departureAirport),
    arrivalAirport: getString(trip.arrivalAirport),
    departureDate: serializeValue(trip.departureDate),
    arrivalDate: serializeValue(trip.arrivalDate),
    lodgingType: getString(trip.lodgingType),
    hotelName: getString(trip.hotelName),
    hotelAddress: getString(trip.hotelAddress),
    checkInDate: serializeValue(trip.checkInDate),
    checkOutDate: serializeValue(trip.checkOutDate),
    joinedUsers: getStringArray(trip.joinedUsers),
    createdBy: getString(trip.createdBy),
  };
}

async function fetchNestedOrLegacyDocs({
  db,
  tripId,
  nestedCollection,
  legacyCollection,
}) {
  const nestedSnap = await db
    .collection(collections.trips)
    .doc(tripId)
    .collection(nestedCollection)
    .limit(100).get();

  if (!nestedSnap.empty) return nestedSnap.docs;

  const legacySnap = await db
    .collection(legacyCollection)
    .where("tripId", "==", tripId)
    .limit(100).get();
  return legacySnap.docs;
}

export async function fetchSharedTripData(tripId, db = getDatabase()) {
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
  if (ownerAccount.data()?.isDeleted || ownerSafety.data()?.restricted) return null;

  const [activitiesDocs, flightsDocs, membersSnap] = await Promise.all([
    fetchNestedOrLegacyDocs({
      db,
      tripId,
      nestedCollection: collections.activities,
      legacyCollection: collections.activity,
    }),
    fetchNestedOrLegacyDocs({
      db,
      tripId,
      nestedCollection: collections.flights,
      legacyCollection: collections.flights,
    }),
    db
      .collection(collections.trips)
      .doc(tripId)
      .collection(collections.members)
      .limit(100).get(),
  ]);

  // Explicit departures override historical joinedUsers arrays.
  const members = new Map(membersSnap.docs.map((doc) => [getString(doc.data().userId) || doc.id, doc.data()]));
  const userIds = uniqueStrings([ownerId, ...members.keys(), ...getStringArray(trip.joinedUsers)])
    .filter((uid) => /^[A-Za-z0-9_-]{1,128}$/.test(uid) && (!members.get(uid)?.status || members.get(uid).status === "active"))
    .slice(0, 100);
  const profiles = await Promise.all(userIds.map(async (uid) => {
    const [profile, account, safety] = await Promise.all([
      db.collection(collections.publicProfile).doc(uid).get(), db.collection("users").doc(uid).get(), db.collection("safetyAccounts").doc(uid).get(),
    ]);
    if (account.data()?.isDeleted || safety.data()?.restricted || profile.data()?.moderationRemoved) return null;
    return {uid, profile};
  }));
  const visibleUsers = new Set(profiles.filter(Boolean).map((item) => item.uid));

  return {
    trip: {...sanitizeTrip(tripDoc.id, trip), joinedUsers: getStringArray(trip.joinedUsers).filter((uid) => visibleUsers.has(uid))},
    members: profiles.filter((item) => item?.profile.exists)
      .map(({uid, profile}) => sanitizeProfile(uid, profile.data())),
    activities: activitiesDocs.filter((doc) => !doc.data().moderationRemoved).map((doc) =>
      sanitizeActivity(doc.id, doc.data()),
    ),
    flights: flightsDocs.filter((doc) => !doc.data().moderationRemoved && visibleUsers.has(doc.data().userId))
      .map((doc) => sanitizeFlight(doc.id, doc.data())),
  };
}

async function handleSharedTripApi(url, response, db) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) {
    sendJson(response, 400, { error: "tripId required" });
    return;
  }

  try {
    const data = await fetchSharedTripData(tripId, db);
    if (!data) {
      sendJson(response, 404, { error: "Trip not found" });
      return;
    }

    sendJson(response, 200, data);
  } catch (error) {
    console.error("shared_trip_failed", {code: error.code || "internal"});
    sendJson(response, 500, { error: "Unable to load shared trip" });
  }
}

async function handlePlacePhotoApi(url, response) {
  if (!googlePlacesApiKey) {
    sendJson(response, 500, { error: "Google Places API key not configured" });
    return;
  }

  const photoName = url.searchParams.get("name") || "";
  if (!isPlacesPhotoName(photoName)) {
    sendJson(response, 400, { error: "Invalid photo name" });
    return;
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
    const photoResponse = await fetch(photoUrl, {headers: {"X-Goog-Api-Key": googlePlacesApiKey}, signal: AbortSignal.timeout(15000)});
    if (!photoResponse.ok || !photoResponse.body) {
      sendJson(response, photoResponse.status || 502, {
        error: "Unable to load place photo",
      });
      return;
    }

    if (!photoResponse.headers.get("content-type")?.startsWith("image/")) {
      sendJson(response, 502, {error: "Unexpected photo response"}); return;
    }
    const imageBuffer = Buffer.from(await photoResponse.arrayBuffer());
    response.writeHead(200, {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": photoResponse.headers.get("content-type") || "image/jpeg",
    });
    response.end(imageBuffer);
  } catch (error) {
    console.error("place_photo_failed", {name: error.name});
    sendJson(response, 502, { error: "Unable to load place photo" });
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

export function createWebServer({database, assistantUpstream = process.env.ASSISTANT_UPSTREAM_URL} = {}) {
 const assistantProxy = createAssistantProxy(assistantUpstream);
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

  if (url.pathname === "/api/shared-trip") {
    handleSharedTripApi(url, response, database);
    return;
  }

  if (url.pathname === "/api/place-photo") {
    handlePlacePhotoApi(url, response);
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
