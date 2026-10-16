export const transportModes = Object.freeze({flight: 'Flight', driving: 'Driving', rideshare: 'Rideshare', taxi: 'Taxi', train: 'Train', bus: 'Bus', scooter: 'Scooter', bicycle: 'Bicycle', walking: 'Walking', ferry: 'Ferry', boat: 'Boat', other: 'Other'});
export function flightTransport(flight, source = 'flight') {
  return {id: `${source}:${flight.id}`, mode: 'flight', userId: flight.userId,
    title: flight.transportTitle || '', displayName: flight.displayName || '',
    origin: flight.departureAirport || '', destination: flight.arrivalAirport || '',
    departure: flight.departureDate || null, arrival: flight.arrivalDate || null,
    provider: flight.airlineName || '', serviceNumber: flight.flightNumber || '',
    travelerNames: flight.travelerNames || [], driver: flight.driver || '', notes: flight.notes || ''};
}
export function sameTransportFlight(a, b) {
  return a.mode === 'flight' && b.mode === 'flight' && a.userId === b.userId &&
    ['origin', 'destination', 'departure', 'arrival', 'provider', 'serviceNumber'].every((key) => (a[key] || '') === (b[key] || ''));
}
export function sortTransportation(entries) {
  return [...entries].sort((a,b) => {
    if (!a.departure && b.departure) return 1;
    if (!b.departure && a.departure) return -1;
    const zoned = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    const order = zoned(a.departure) && zoned(b.departure) ? new Date(a.departure) - new Date(b.departure) : (a.departure || '').localeCompare(b.departure || '');
    return order || a.id.localeCompare(b.id);
  });
}
