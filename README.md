# Breez Mobility POC

Pre-scheduled EV ride platform. Built with Express, PostgreSQL, Redis, and Server-Sent Events.

## Architecture

```
REST (mutations) → Express API → PostgreSQL (durable state)
                              → Redis pub/sub (fan-out)
                              → SSE (push to clients)

Redis GEO      ← Driver GPS pings (3-5s intervals)
Redis Hashes   ← Online status, OTP codes (TTL-based)
Redis SETNX    ← Idempotency keys, distributed locks
```

Patterns from Uber, Lyft, Grab engineering:
- **Dual-store**: Redis for hot path (locations, ephemeral), Postgres for cold path (rides, audit)
- **Event sourcing**: Every ride state change appended to `ride_events` table
- **Optimistic concurrency**: `version` column prevents double-assignment race conditions
- **State machine**: Directed graph of valid transitions, no ad-hoc if/else
- **SSE + Redis pub/sub**: Same pattern as Uber's RAMEN push platform (pre-gRPC era)
- **Idempotency keys**: Redis SETNX prevents duplicate mutations from network retries

## Quick Start

```bash
docker compose up --build
```

This starts 4 containers:
- **postgres** - PostgreSQL 16
- **redis** - Redis 7
- **app** - Express API (auto-runs migrations + seed)
- **simulation** - Runs 100 rides through full lifecycle

Open http://localhost:3000/map.html to watch the simulation live.

## API Endpoints

### Auth
- `POST /auth/send-otp` - Send WhatsApp OTP
- `POST /auth/verify-otp` - Verify OTP, get JWT
- `POST /auth/driver-login` - Employee ID + PIN login
- `POST /auth/admin-login` - Admin login

### Rides (Passenger)
- `POST /rides` - Book a ride (3hr min advance)
- `GET /rides` - List my rides
- `GET /rides/:id` - Ride detail + event history
- `PATCH /rides/:id/cancel` - Cancel with reason

### Rides (Driver)
- `PATCH /rides/:id/status` - Progress: EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
- `GET /drivers/assignments` - My upcoming rides

### Driver
- `POST /drivers/online` - Go online
- `POST /drivers/offline` - Go offline
- `POST /drivers/location` - GPS ping (lat, lng)
- `POST /drivers/battery-log` - Submit battery event

### Admin
- `POST /admin/assign` - Assign driver to ride
- `GET /admin/queue` - Unassigned rides
- `GET /admin/fleet` - All vehicles + live locations
- `GET /admin/drivers` - All drivers + online status
- `GET /admin/slabs` - Fare slabs
- `PUT /admin/slabs/:id` - Update slab pricing

### SSE Event Streams
- `GET /events/ride/:id?token=` - Ride updates (passenger)
- `GET /events/driver/:id?token=` - Assignment notifications (driver)
- `GET /events/fleet?token=` - All fleet events (admin dashboard)

## Testing

```bash
# Unit tests (state machine, battery sequence, slab lookup)
npm test

# Integration tests (requires running services)
API_URL=http://localhost:3000 node --test tests/lifecycle.test.js
```

## Seed Data

- 4 fare slabs (0-10km, 10-25km, 25-50km, 50+km)
- 1 super admin, 1 ops admin
- 30 drivers (employee IDs: BRZ0001-BRZ0030, PIN: 1234)
- 20 vehicles (Mumbai plates, EV models)
- 100 passengers

## Simulation

The simulation container:
1. Logs in all 30 drivers, goes online
2. Books 100 rides with random Mumbai pickup/drop points
3. Admin assigns drivers (round-robin, skips conflicts)
4. Each ride progresses through full state machine with GPS pings
5. Battery logs submitted at vehicle pickup/drop
6. All events stream to the live map via SSE
