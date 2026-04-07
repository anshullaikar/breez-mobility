const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isAdmin, canViewRide } = require('../src/services/access');

const ride = { passengerId: 'p1', driverId: 'd1' };

describe('Ride access', () => {
  it('treats ADMIN and SUPER_ADMIN as admins', () => {
    assert.ok(isAdmin({ role: 'ADMIN' }));
    assert.ok(isAdmin({ role: 'SUPER_ADMIN' }));
    assert.ok(!isAdmin({ role: 'DRIVER' }));
    assert.ok(!isAdmin({ role: 'PASSENGER' }));
  });

  it('lets the passenger and assigned driver view the ride', () => {
    assert.ok(canViewRide({ id: 'p1', role: 'PASSENGER' }, ride));
    assert.ok(canViewRide({ id: 'd1', role: 'DRIVER' }, ride));
  });

  it('hides the ride from other passengers and drivers', () => {
    assert.ok(!canViewRide({ id: 'p2', role: 'PASSENGER' }, ride));
    assert.ok(!canViewRide({ id: 'd2', role: 'DRIVER' }, ride));
  });

  it('lets admins view any ride, including unassigned ones', () => {
    assert.ok(canViewRide({ id: 'a1', role: 'ADMIN' }, { passengerId: 'p1', driverId: null }));
  });
});
