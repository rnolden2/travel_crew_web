const textPresent = (value) => typeof value === 'string' && value.trim().length > 0;
const datePresent = (value) => value != null && value !== '' && Number.isFinite(new Date(value).getTime());
export const hasLodging = (option) => [option.lodgingType, option.hotelName, option.hotelAddress].some(textPresent) ||
  [option.checkInDate, option.checkOutDate].some(datePresent) || option.expensePerNight > 0;
