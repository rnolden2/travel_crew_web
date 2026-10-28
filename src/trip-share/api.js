export async function fetchSharedTrip(tripId) {
  try {
    const response = await fetch(`/api/shared-trip?tripId=${encodeURIComponent(tripId)}&summary=1`, {
      headers: { Accept: 'application/json' },
    });

    if (response.status === 413) return {error: 'tooLarge'};
    if (response.status === 404) return null;
    if (!response.ok) return {error: 'loadFailed'};
    const data = await response.json();
    return {...data, activities: [], lodgings: [], transportation: []};
  } catch (error) {
    console.error('Unable to fetch shared trip:', error);
    return {error: 'loadFailed'};
  }
}

export async function fetchSharedTripSection(tripId, section, source = 'nested', cursor = null) {
  const params = new URLSearchParams({tripId, section, source});
  if (cursor) params.set('cursor', cursor);
  try {
    const response = await fetch(`/api/shared-trip-section?${params}`, {
      headers: {Accept: 'application/json'},
    });
    if (response.status === 404) return {error: 'notFound'};
    if (!response.ok) return {error: 'loadFailed'};
    return response.json();
  } catch (error) {
    console.error('Unable to fetch shared trip section:', error);
    return {error: 'loadFailed'};
  }
}
