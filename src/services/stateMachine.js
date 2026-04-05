// Directed graph: valid ride status transitions
const RIDE_TRANSITIONS = {
  BOOKED:      ['ASSIGNED', 'CANCELLED'],
  ASSIGNED:    ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE:    ['ARRIVED'],
  ARRIVED:     ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED:   [],
  CANCELLED:   [],
};

// Battery log events must follow this sequence per shift
const BATTERY_SEQUENCE = ['VEHICLE_PICKUP', 'VEHICLE_DROP', 'CHARGE_START', 'CHARGE_END'];

const MIN_BOOKING_HOURS = 3;
const CANCELLATION_WINDOW_HOURS = 2;

function canTransition(from, to) {
  return RIDE_TRANSITIONS[from]?.includes(to) || false;
}

function validateNextBatteryEvent(existingLogs, newEventType) {
  const nextIndex = existingLogs.length;
  if (nextIndex >= BATTERY_SEQUENCE.length) return false;
  return BATTERY_SEQUENCE[nextIndex] === newEventType;
}

function findSlab(slabs, distanceKm) {
  // Slabs sorted by maxKm - binary search
  let lo = 0;
  let hi = slabs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slabs[mid].maxKm >= distanceKm) hi = mid;
    else lo = mid + 1;
  }
  return slabs[lo];
}

module.exports = {
  RIDE_TRANSITIONS,
  BATTERY_SEQUENCE,
  MIN_BOOKING_HOURS,
  CANCELLATION_WINDOW_HOURS,
  canTransition,
  validateNextBatteryEvent,
  findSlab,
};
