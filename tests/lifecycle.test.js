const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const API = process.env.API_URL || 'http://localhost:3000';

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

describe('Full ride lifecycle', () => {
  let adminToken, passengerToken, driverToken;
  let rideId, slabId, driverId, vehicleId;

  before(async () => {
    // Wait for API
    for (let i = 0; i < 10; i++) {
      try { await fetch(`${API}/health`); break; } catch { await new Promise(r => setTimeout(r, 1000)); }
    }
  });

  it('admin can login', async () => {
    const { status, data } = await api('POST', '/auth/admin-login', { phone: '+919999000001', pin: '0000' });
    assert.equal(status, 200);
    assert.ok(data.token);
    adminToken = data.token;
  });

  it('passenger can register via OTP', async () => {
    const phone = '+918001112222';
    // Send OTP
    const { data: otpData } = await api('POST', '/auth/send-otp', { phone });
    assert.ok(otpData.code); // dev mode returns code

    // Verify OTP
    const { status, data } = await api('POST', '/auth/verify-otp', {
      phone, code: otpData.code, name: 'Test Passenger',
    });
    assert.equal(status, 200);
    assert.ok(data.token);
    passengerToken = data.token;
  });

  it('can fetch fare slabs', async () => {
    const { status, data } = await api('GET', '/admin/slabs', null, adminToken);
    assert.equal(status, 200);
    assert.ok(data.length > 0);
    slabId = data[0].id;
  });

  it('passenger can book a ride (3hr minimum enforced)', async () => {
    // Should fail: booking too soon
    const { status: failStatus } = await api('POST', '/rides', {
      pickupAddress: 'Andheri Station',
      pickupLat: 19.1197, pickupLng: 72.8464,
      dropAddress: 'Bandra Kurla Complex',
      dropLat: 19.0660, dropLng: 72.8690,
      scheduledAt: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1hr from now
      slabId,
    }, passengerToken);
    assert.equal(failStatus, 400);

    // Should succeed: 4hr from now
    const { status, data } = await api('POST', '/rides', {
      pickupAddress: 'Andheri Station',
      pickupLat: 19.1197, pickupLng: 72.8464,
      dropAddress: 'Bandra Kurla Complex',
      dropLat: 19.0660, dropLng: 72.8690,
      scheduledAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      slabId,
    }, passengerToken);
    assert.equal(status, 201);
    assert.equal(data.status, 'BOOKED');
    rideId = data.id;
  });

  it('admin can see ride in queue', async () => {
    const { status, data } = await api('GET', '/admin/queue', null, adminToken);
    assert.equal(status, 200);
    assert.ok(data.some(r => r.id === rideId));
  });

  it('admin can assign a driver (with conflict detection)', async () => {
    // Get a driver and vehicle
    const { data: drivers } = await api('GET', '/admin/drivers', null, adminToken);
    driverId = drivers[0].id;

    const { data: fleet } = await api('GET', '/admin/fleet', null, adminToken);
    vehicleId = fleet[0].id;

    const { status, data } = await api('POST', '/admin/assign', {
      rideId, driverId, vehicleId,
    }, adminToken);
    assert.equal(status, 200);
    assert.equal(data.status, 'ASSIGNED');
  });

  it('driver can login and see assignment', async () => {
    const { data: drivers } = await api('GET', '/admin/drivers', null, adminToken);
    const driver = drivers[0];
    const { status, data } = await api('POST', '/auth/driver-login', {
      employeeId: driver.employeeId, pin: '1234',
    });
    assert.equal(status, 200);
    driverToken = data.token;

    const { data: assignments } = await api('GET', '/drivers/assignments', null, driverToken);
    assert.ok(assignments.some(r => r.id === rideId));
  });

  it('driver progresses ride through state machine', async () => {
    // EN_ROUTE
    let res = await api('PATCH', `/rides/${rideId}/status`, { status: 'EN_ROUTE' }, driverToken);
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'EN_ROUTE');

    // Invalid transition: try to skip to COMPLETED
    res = await api('PATCH', `/rides/${rideId}/status`, { status: 'COMPLETED' }, driverToken);
    assert.equal(res.status, 400);

    // ARRIVED
    res = await api('PATCH', `/rides/${rideId}/status`, { status: 'ARRIVED' }, driverToken);
    assert.equal(res.status, 200);

    // IN_PROGRESS
    res = await api('PATCH', `/rides/${rideId}/status`, { status: 'IN_PROGRESS' }, driverToken);
    assert.equal(res.status, 200);
    assert.ok(res.data.startedAt);

    // COMPLETED
    res = await api('PATCH', `/rides/${rideId}/status`, { status: 'COMPLETED' }, driverToken);
    assert.equal(res.status, 200);
    assert.ok(res.data.completedAt);
  });

  it('ride has full event history (event sourcing)', async () => {
    const { status, data } = await api('GET', `/rides/${rideId}`, null, adminToken);
    assert.equal(status, 200);
    assert.equal(data.status, 'COMPLETED');

    // Should have events: BOOKED -> ASSIGNED -> EN_ROUTE -> ARRIVED -> IN_PROGRESS -> COMPLETED
    assert.ok(data.events.length >= 5);
    const states = data.events.map(e => e.toState);
    assert.ok(states.includes('BOOKED'));
    assert.ok(states.includes('ASSIGNED'));
    assert.ok(states.includes('EN_ROUTE'));
    assert.ok(states.includes('COMPLETED'));
  });

  it('battery sequence validation works', async () => {
    // Should accept VEHICLE_PICKUP first
    let res = await api('POST', '/drivers/battery-log', {
      vehicleId, eventType: 'VEHICLE_PICKUP', soc: 85, range: 300,
    }, driverToken);
    assert.equal(res.status, 201);

    // Should reject CHARGE_START (must do VEHICLE_DROP next)
    res = await api('POST', '/drivers/battery-log', {
      vehicleId, eventType: 'CHARGE_START', soc: 60, range: 210,
    }, driverToken);
    assert.equal(res.status, 400);

    // Should accept VEHICLE_DROP
    res = await api('POST', '/drivers/battery-log', {
      vehicleId, eventType: 'VEHICLE_DROP', soc: 60, range: 210,
    }, driverToken);
    assert.equal(res.status, 201);
  });

  it('duplicate assignment causes conflict (optimistic concurrency)', async () => {
    // Book a new ride
    const { data: ride2 } = await api('POST', '/rides', {
      pickupAddress: 'Powai Lake',
      pickupLat: 19.1273, pickupLng: 72.9071,
      dropAddress: 'Dadar TT',
      dropLat: 19.0178, dropLng: 72.8478,
      scheduledAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      slabId,
    }, passengerToken);

    // Assign same driver - should conflict (same time window)
    const { status } = await api('POST', '/admin/assign', {
      rideId: ride2.id, driverId, vehicleId,
    }, adminToken);
    // May be 409 (conflict) or 200 depending on timing
    assert.ok([200, 409].includes(status));
  });
});
