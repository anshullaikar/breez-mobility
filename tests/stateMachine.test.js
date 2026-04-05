const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  canTransition,
  validateNextBatteryEvent,
  findSlab,
  RIDE_TRANSITIONS,
  BATTERY_SEQUENCE,
} = require('../src/services/stateMachine');

describe('Ride state machine', () => {
  it('allows valid transitions', () => {
    assert.ok(canTransition('BOOKED', 'ASSIGNED'));
    assert.ok(canTransition('BOOKED', 'CANCELLED'));
    assert.ok(canTransition('ASSIGNED', 'EN_ROUTE'));
    assert.ok(canTransition('EN_ROUTE', 'ARRIVED'));
    assert.ok(canTransition('ARRIVED', 'IN_PROGRESS'));
    assert.ok(canTransition('IN_PROGRESS', 'COMPLETED'));
  });

  it('rejects invalid transitions', () => {
    assert.ok(!canTransition('BOOKED', 'EN_ROUTE'));      // must be assigned first
    assert.ok(!canTransition('BOOKED', 'COMPLETED'));      // can't skip
    assert.ok(!canTransition('COMPLETED', 'BOOKED'));      // terminal state
    assert.ok(!canTransition('CANCELLED', 'BOOKED'));      // terminal state
    assert.ok(!canTransition('IN_PROGRESS', 'CANCELLED')); // can't cancel mid-ride
    assert.ok(!canTransition('EN_ROUTE', 'IN_PROGRESS'));  // must arrive first
  });

  it('treats COMPLETED and CANCELLED as terminal', () => {
    assert.deepEqual(RIDE_TRANSITIONS.COMPLETED, []);
    assert.deepEqual(RIDE_TRANSITIONS.CANCELLED, []);
  });

  it('handles unknown states', () => {
    assert.ok(!canTransition('UNKNOWN', 'BOOKED'));
    assert.ok(!canTransition(null, 'BOOKED'));
    assert.ok(!canTransition(undefined, 'BOOKED'));
  });
});

describe('Battery sequence validation', () => {
  it('accepts correct sequence', () => {
    assert.ok(validateNextBatteryEvent([], 'VEHICLE_PICKUP'));
    assert.ok(validateNextBatteryEvent([{ eventType: 'VEHICLE_PICKUP' }], 'VEHICLE_DROP'));
    assert.ok(validateNextBatteryEvent(
      [{ eventType: 'VEHICLE_PICKUP' }, { eventType: 'VEHICLE_DROP' }],
      'CHARGE_START'
    ));
    assert.ok(validateNextBatteryEvent(
      [{ eventType: 'VEHICLE_PICKUP' }, { eventType: 'VEHICLE_DROP' }, { eventType: 'CHARGE_START' }],
      'CHARGE_END'
    ));
  });

  it('rejects out-of-order events', () => {
    assert.ok(!validateNextBatteryEvent([], 'VEHICLE_DROP'));        // must start with pickup
    assert.ok(!validateNextBatteryEvent([], 'CHARGE_START'));        // must start with pickup
    assert.ok(!validateNextBatteryEvent(
      [{ eventType: 'VEHICLE_PICKUP' }], 'CHARGE_START'             // must drop before charge
    ));
  });

  it('rejects events after sequence is complete', () => {
    const fullSequence = BATTERY_SEQUENCE.map(e => ({ eventType: e }));
    assert.ok(!validateNextBatteryEvent(fullSequence, 'VEHICLE_PICKUP'));
    assert.ok(!validateNextBatteryEvent(fullSequence, 'CHARGE_END'));
  });
});

describe('Fare slab lookup', () => {
  const slabs = [
    { maxKm: 10, price: 15000 },
    { maxKm: 25, price: 30000 },
    { maxKm: 50, price: 50000 },
    { maxKm: 9999, price: 80000 },
  ];

  it('finds correct slab by distance', () => {
    assert.equal(findSlab(slabs, 5).price, 15000);
    assert.equal(findSlab(slabs, 10).price, 15000);
    assert.equal(findSlab(slabs, 15).price, 30000);
    assert.equal(findSlab(slabs, 25).price, 30000);
    assert.equal(findSlab(slabs, 30).price, 50000);
    assert.equal(findSlab(slabs, 100).price, 80000);
  });

  it('handles edge cases', () => {
    assert.equal(findSlab(slabs, 0).price, 15000);
    assert.equal(findSlab(slabs, 1).price, 15000);
    assert.equal(findSlab(slabs, 9999).price, 80000);
  });
});
