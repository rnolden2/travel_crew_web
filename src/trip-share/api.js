export async function fetchSharedTrip(tripId) {
  try {
    const response = await fetch(`/api/shared-trip?tripId=${encodeURIComponent(tripId)}`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error('Unable to fetch shared trip:', error);
    return null;
  }
}
