export const transportModes = Object.freeze({flight: 'Flight', driving: 'Driving', rideshare: 'Rideshare', taxi: 'Taxi', train: 'Train', bus: 'Bus', scooter: 'Scooter', bicycle: 'Bicycle', walking: 'Walking', ferry: 'Ferry', boat: 'Boat', other: 'Other'});
export function sortTransportation(entries) {
  return [...entries].sort((a,b) => {
    if (!a.departure && b.departure) return 1;
    if (!b.departure && a.departure) return -1;
    const zoned = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    const order = zoned(a.departure) && zoned(b.departure) ? new Date(a.departure) - new Date(b.departure) : (a.departure || '').localeCompare(b.departure || '');
    return order || a.id.localeCompare(b.id);
  });
}
