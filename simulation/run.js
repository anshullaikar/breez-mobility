const API = process.env.API_URL || 'http://app:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => Math.random() * 2000 + 500; // 0.5-2.5s

// Mumbai landmarks for realistic routes
const LOCATIONS = [
  { name: 'Andheri Station', lat: 19.1197, lng: 72.8464 },
  { name: 'Bandra Kurla Complex', lat: 19.0660, lng: 72.8690 },
  { name: 'Powai Lake', lat: 19.1273, lng: 72.9071 },
  { name: 'Dadar TT', lat: 19.0178, lng: 72.8478 },
  { name: 'Colaba Causeway', lat: 18.9217, lng: 72.8317 },
  { name: 'Juhu Beach', lat: 19.0883, lng: 72.8264 },
  { name: 'Lower Parel', lat: 18.9930, lng: 72.8309 },
  { name: 'Goregaon', lat: 19.1663, lng: 72.8526 },
  { name: 'Thane Station', lat: 19.1860, lng: 72.9755 },
  { name: 'Worli Seaface', lat: 19.0140, lng: 72.8154 },
  { name: 'Malad West', lat: 19.1872, lng: 72.8484 },
  { name: 'Vashi', lat: 19.0771, lng: 72.9987 },
  { name: 'Chembur', lat: 19.0622, lng: 72.8978 },
  { name: 'Borivali', lat: 19.2307, lng: 72.8567 },
  { name: 'Fort', lat: 18.9338, lng: 72.8355 },
];

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function interpolate(start, end, progress) {
  return {
    lat: start.lat + (end.lat - start.lat) * progress + (Math.random() - 0.5) * 0.001,
    lng: start.lng + (end.lng - start.lng) * progress + (Math.random() - 0.5) * 0.001,
  };
}

function pickTwo() {
  const a = Math.floor(Math.random() * LOCATIONS.length);
  let b = Math.floor(Math.random() * LOCATIONS.length);
  while (b === a) b = Math.floor(Math.random() * LOCATIONS.length);
  return [LOCATIONS[a], LOCATIONS[b]];
}

async function run() {
  console.log('[SIM] Waiting for API...');
  for (let i = 0; i < 30; i++) {
    try {
      await api('GET', '/health');
      break;
    } catch {
      await sleep(2000);
    }
  }
  console.log('[SIM] API is up');

  // Login as admin
  const admin = await api('POST', '/auth/admin-login', { phone: '+919999000001', pin: '0000' });
  console.log('[SIM] Admin logged in');

  // Get slabs
  const slabs = await api('GET', '/admin/slabs', null, admin.token);
  console.log(`[SIM] Got ${slabs.length} fare slabs`);

  // Get drivers and vehicles
  const drivers = await api('GET', '/admin/drivers', null, admin.token);
  const vehicles = await prismaFetch('/admin/fleet', admin.token);
  console.log(`[SIM] ${drivers.length} drivers, ${vehicles.length} vehicles`);

  // Login all drivers
  const driverTokens = {};
  for (const d of drivers) {
    try {
      const login = await api('POST', '/auth/driver-login', { employeeId: d.employeeId, pin: '1234' });
      driverTokens[d.id] = login.token;
      // Go online
      await api('POST', '/drivers/online', {}, login.token);
    } catch (err) {
      console.warn(`[SIM] Driver login failed: ${d.employeeId}`, err.message);
    }
  }
  console.log(`[SIM] ${Object.keys(driverTokens).length} drivers online`);

  // Login passengers and book rides
  const rides = [];
  const passengerTokens = {};

  for (let i = 1; i <= 100; i++) {
    try {
      const phone = `+91800000${String(i).padStart(4, '0')}`;
      // Direct OTP for simulation
      await api('POST', '/auth/send-otp', { phone });

      // In dev mode, OTP is returned in response
      const otp = await getOtp(phone);
      const pLogin = await api('POST', '/auth/verify-otp', { phone, code: otp, name: `Passenger ${i}` });
      passengerTokens[pLogin.user.id] = pLogin.token;

      const [pickup, drop] = pickTwo();
      const scheduledAt = new Date(Date.now() + (3 + Math.random() * 4) * 60 * 60 * 1000);
      const slab = slabs[Math.floor(Math.random() * slabs.length)];

      const ride = await api('POST', '/rides', {
        pickupAddress: pickup.name,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropAddress: drop.name,
        dropLat: drop.lat,
        dropLng: drop.lng,
        scheduledAt: scheduledAt.toISOString(),
        slabId: slab.id,
      }, pLogin.token);

      rides.push({ ...ride, pickup, drop, passengerToken: pLogin.token });
    } catch (err) {
      console.warn(`[SIM] Booking ${i} failed:`, err.message);
    }
  }
  console.log(`[SIM] ${rides.length} rides booked`);

  // Assign drivers (round-robin with conflict awareness)
  const driverIds = Object.keys(driverTokens);
  const vehicleIds = vehicles.map(v => v.id);
  let assigned = 0;

  for (let i = 0; i < rides.length; i++) {
    const ride = rides[i];
    const driverId = driverIds[i % driverIds.length];
    const vehicleId = vehicleIds[i % vehicleIds.length];

    try {
      await api('POST', '/admin/assign', { rideId: ride.id, driverId, vehicleId }, admin.token);
      ride.driverId = driverId;
      ride.vehicleId = vehicleId;
      assigned++;
    } catch (err) {
      // Expected: some will conflict
    }
  }
  console.log(`[SIM] ${assigned} rides assigned (${rides.length - assigned} conflicts)`);

  // Simulate ride lifecycle with GPS pings
  const stats = { enRoute: 0, arrived: 0, inProgress: 0, completed: 0, failed: 0 };

  const ridePromises = rides
    .filter(r => r.driverId)
    .map(async (ride, idx) => {
      try {
        // Stagger starts
        await sleep(idx * 200 + Math.random() * 1000);

        const driverToken = driverTokens[ride.driverId];
        if (!driverToken) return;

        // Submit battery log: vehicle pickup
        try {
          const soc = 60 + Math.floor(Math.random() * 35);
          await api('POST', '/drivers/battery-log', {
            vehicleId: ride.vehicleId,
            eventType: 'VEHICLE_PICKUP',
            soc,
            range: Math.floor(soc * 3.5),
          }, driverToken);
        } catch {}

        // EN_ROUTE + GPS pings toward pickup
        await api('PATCH', `/rides/${ride.id}/status`, { status: 'EN_ROUTE' }, driverToken);
        stats.enRoute++;

        // Simulate driving to pickup (5 GPS pings)
        const startPos = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
        for (let p = 0; p < 5; p++) {
          const pos = interpolate(startPos, ride.pickup, (p + 1) / 5);
          await api('POST', '/drivers/location', pos, driverToken);
          await sleep(300);
        }

        // ARRIVED
        await api('PATCH', `/rides/${ride.id}/status`, { status: 'ARRIVED' }, driverToken);
        stats.arrived++;
        await sleep(jitter());

        // IN_PROGRESS + GPS pings along route
        await api('PATCH', `/rides/${ride.id}/status`, { status: 'IN_PROGRESS' }, driverToken);
        stats.inProgress++;

        for (let p = 0; p < 8; p++) {
          const pos = interpolate(ride.pickup, ride.drop, (p + 1) / 8);
          await api('POST', '/drivers/location', pos, driverToken);
          await sleep(300);
        }

        // COMPLETED
        await api('PATCH', `/rides/${ride.id}/status`, { status: 'COMPLETED' }, driverToken);
        stats.completed++;

        // Battery log: vehicle drop
        try {
          const dropSoc = 20 + Math.floor(Math.random() * 40);
          await api('POST', '/drivers/battery-log', {
            vehicleId: ride.vehicleId,
            eventType: 'VEHICLE_DROP',
            soc: dropSoc,
            range: Math.floor(dropSoc * 3.5),
          }, driverToken);
        } catch {}

      } catch (err) {
        stats.failed++;
      }
    });

  // Progress logger
  const progressInterval = setInterval(() => {
    console.log(`[SIM] en_route:${stats.enRoute} arrived:${stats.arrived} in_progress:${stats.inProgress} completed:${stats.completed} failed:${stats.failed}`);
  }, 3000);

  await Promise.all(ridePromises);
  clearInterval(progressInterval);

  console.log(`\n[SIM] === COMPLETE ===`);
  console.log(`[SIM] ${stats.completed} rides completed, ${stats.failed} failed`);
  console.log(`[SIM] Open http://localhost:3000/map.html to see results`);
}

// Helper to get OTP (in dev mode it's in the response)
async function getOtp(phone) {
  const res = await fetch(`${API}/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  return data.code || '000000';
}

// Helper to fetch (GET with token)
async function prismaFetch(path, token) {
  return api('GET', path, null, token);
}

run().catch(err => {
  console.error('[SIM] Fatal:', err);
  process.exit(1);
});
