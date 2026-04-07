# Breez Mobility

Proof-of-concept platform for **pre-scheduled EV rides**. Passengers book rides at least 3 hours ahead, ops admins assign drivers and vehicles, and drivers run their shift: battery logs, going online, GPS tracking, and taking rides through to completion. Every state change is pushed live to the right screens.

**Stack:** Node 20 · Express 4 · PostgreSQL 16 (Prisma) · Redis 7 · Server-Sent Events · React 18 + Vite + Tailwind + Leaflet

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design decisions, data flow, state machines, trade-offs
- [SKILL.md](SKILL.md): a detailed map of the codebase (where things live, conventions, how to extend it)

---

## Architecture at a glance

```
            ┌───────────────────────────── client (nginx) ─────────────────────────────┐
 Browser ── │  React SPA (/login /passenger /driver /manager)                          │
            │  proxies /auth /rides /admin /drivers /events /health  ──────────┐       │
            └──────────────────────────────────────────────────────────────────┼───────┘
                                                                               ▼
                                                             ┌──────────── app (Express) ───────────┐
   REST mutations ─────────────────────────────────────────► │ routes → state machine → Prisma      │──► PostgreSQL
                                                             │                         → publish()  │    rides, ride_events,
   SSE  (/events/ride/:id, /events/driver/:id, /events/fleet)│ ◄── psubscribe ride:* driver:* fleet │    users, vehicles,
        ◄─────────────────────────────────────────────────── │                                      │    battery_logs, fare_slabs
                                                             └───────────────┬──────────────────────┘
                                                                             ▼
                                                                           Redis
                                                  GEO vehicles:active · vehicle:{id}:loc (TTL 120s)
                                                  driver:{id}:online (TTL 60s) · otp:{phone} (TTL 300s)
                                                  idempotency:{user}:{key} · pub/sub channels
```

| Pattern | Where | Why |
|---|---|---|
| Dual store | Postgres for durable state, Redis for hot and ephemeral data | GPS pings every 3–5 s shouldn't hit Postgres |
| Event log | `ride_events` table, one row per transition | Audit trail, timeline in the UI, debugging |
| State machine | `src/services/stateMachine.js` | One table of legal transitions instead of scattered if/else |
| Optimistic concurrency | `rides.version` column + `updateMany where version` | Two admins can't double-assign the same ride |
| Idempotency keys | `X-Idempotency-Key` → Redis `SET NX` | Safe retries from flaky mobile networks |
| SSE + Redis pub/sub | `src/sse/manager.js` | Server → client push that works across several API instances |
| Geofencing | `PATCH /rides/:id/status` | Driver must be ≤ 50 m from pickup to start and ≤ 300 m from drop-off to complete |

## Quick start (Docker)

```bash
docker compose up --build
```

| Service | URL | Notes |
|---|---|---|
| client | http://localhost:5173 | React app built and served by nginx |
| app | http://localhost:3000 | API; `/health`, live fleet map at `/map.html` |
| postgres | localhost:5432 | `breez` / `breez` |
| redis | localhost:6379 | |

On start, the API applies Prisma migrations and (with `SEED_ON_START=true`, set in compose) seeds demo data.

To also run the load simulation (drivers go online, 100 rides booked, assigned, and driven to completion):

```bash
docker compose --profile simulation up --build
```

> **Upgrading an older local volume?** Earlier versions created the schema with `prisma db push`. If `migrate deploy` fails with P3005, either reset with `docker compose down -v`, or keep your data and run `npx prisma migrate resolve --applied 0_init`.

## Local development (without Docker for the app)

```bash
docker compose up -d postgres redis   # just the datastores
cp .env.example .env
npm install
npm run db:migrate && npm run seed
npm start                             # API on :3000

cd client && npm install && npm run dev   # Vite on :5173, proxies API calls to :3000
```

## Demo logins

| Role | How to log in |
|---|---|
| Passenger | Any phone number → **Send OTP**. In `NODE_ENV=development` the code is returned in the response (and logged). Name is required on first login. |
| Driver | Employee ID `BRZ0001` … `BRZ0030`, PIN `1234`. An admin must assign the driver a vehicle first (Manager → Fleet). |
| Super admin | Phone `+919999000001`, PIN `0000` |
| Ops admin | Phone `+919999000002`, PIN `0000` |

Seed data: 4 fare slabs (0–10, 10–25, 25–50, 50+ km), 30 drivers, 20 vehicles (Mumbai plates, EV models), 100 passengers.

## Environment variables

See [.env.example](.env.example).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | none | Postgres connection string |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis |
| `JWT_SECRET` | yes in production | dev fallback | The API refuses to start in production without it |
| `NODE_ENV` | no | none | `development` returns OTP codes in API responses |
| `PORT` | no | `3000` | API port |
| `CORS_ORIGIN` | no | all origins | Comma-separated allow-list |
| `SEED_ON_START` | no | none | `true` runs the idempotent seed on container start |
| `API_UPSTREAM` | client only | `http://app:3000` | Where nginx proxies API and SSE traffic |

## API reference

All endpoints except `/auth/*` and `/health` need `Authorization: Bearer <jwt>`. SSE endpoints take `?token=` because `EventSource` can't set headers.

### Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/send-otp` | `{ phone }` | 6-digit code, 5-minute TTL |
| POST | `/auth/verify-otp` | `{ phone, code, name?, dob? }` | Creates the passenger on first login |
| POST | `/auth/driver-login` | `{ employeeId, pin }` | |
| POST | `/auth/admin-login` | `{ phone, pin }` | |

### Rides
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/rides` | passenger | ≥ 3 h ahead; fare comes from the chosen slab; idempotent |
| GET | `/rides` | any | Passenger sees own, driver sees assigned, admin sees all. `?status=&limit=&offset=` |
| GET | `/rides/:id` | participant / admin | Includes the `events` timeline |
| PATCH | `/rides/:id/status` | assigned driver | `{ status, version? }`: state machine + geofence + optimistic lock; idempotent |
| PATCH | `/rides/:id/cancel` | passenger / admin | `{ reason }`. Passengers can't cancel within 2 h of pickup |

### Driver
| Method | Path | Notes |
|---|---|---|
| GET | `/drivers/shift-state` | What the driver UI should show next (see ARCHITECTURE.md) |
| POST | `/drivers/battery-log` | `{ soc, range?, notes? }`. Pickup or drop is detected from the shift state |
| POST | `/drivers/online` / `/drivers/offline` | Going online requires today's pickup battery log |
| POST | `/drivers/start-charging` / `/drivers/end-charging` | `{ soc, chargerStation? }` |
| POST | `/drivers/location` | `{ lat, lng }`. Updates the Redis geo index and fans out to the fleet and the active ride |
| GET | `/drivers/assignments` | Non-terminal rides for this driver |
| GET | `/drivers/nearby` | Admin. `?lat=&lng=&radius=km` → `[{ vehicleId, distanceKm }]` |

### Admin (ADMIN / SUPER_ADMIN)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/queue` | BOOKED rides by pickup time |
| GET | `/admin/active-rides` · `/admin/completed-rides?page=&limit=` | |
| POST | `/admin/assign` | `{ rideId, driverId, vehicleId }`. Rejects conflicts within ±2 h; optimistic lock |
| POST | `/admin/reassign` | `{ rideId, driverId, vehicleId? }`. ASSIGNED or EN_ROUTE only |
| POST | `/admin/cancel-ride` | `{ rideId, reason }` |
| GET | `/admin/fleet` · `/admin/vehicles/:id/detail` | Vehicles with live location, SOC, today's trips |
| CRUD | `/admin/drivers[/:id]` · `/admin/vehicles[/:id]` | Delete deactivates (soft delete) |
| POST | `/admin/vehicles/:id/assign-driver` · `/unassign-driver` | |
| GET | `/admin/events` | Recent ride and battery events (24 h) |
| GET | `/admin/slabs` | Any authenticated user (the booking form needs it) |
| POST/PUT/DELETE | `/admin/slabs[/:id]` | SUPER_ADMIN only |

### Live event streams (SSE)
| Path | Who | Events |
|---|---|---|
| `/events/ride/:id` | ride's passenger, driver, admin | `status_change`, `driver_assigned`, `driver_location`, `ride_cancelled` |
| `/events/driver/:id` | that driver, admin | `ride_assigned`, `ride_update` |
| `/events/fleet` | admin | `ride_booked`, `ride_assigned`, `ride_status_change`, `vehicle_location`, `battery_log`, `low_battery_alert`, `driver_online`/`offline`, … |

## Testing

```bash
npm test                     # unit: state machine, access rules, async error routing
npm run test:integration     # full ride lifecycle against a running stack (API_URL, default :3000)
```

## Project layout

```
src/
  server.js              Express app, middleware, error handler, SSE init
  config/                Prisma client, Redis clients (command + subscriber)
  middleware/            auth (JWT, roles), idempotency, asyncRouter
  routes/                auth, rides, drivers, admin, events (SSE)
  services/              stateMachine (transitions, slabs), access (ownership rules)
  sse/manager.js         Redis psubscribe → SSE fan-out, heartbeats
prisma/                  schema, migrations, seed
client/                  React app (Vite) + nginx config
simulation/run.js        End-to-end load simulation
public/map.html          Standalone live fleet map
tests/                   node:test unit + integration suites
```

## Known limitations

This is a proof of concept. Next steps, in rough priority order:

- **OTP delivery** is stubbed (logged to the console); the WhatsApp integration and rate limiting on `/auth/send-otp` are TODO.
- **PINs are stored in plaintext.** They should be hashed (bcrypt or argon2) and login attempts rate-limited.
- **Multi-step writes aren't transactional.** A ride update and its `ride_events` row are separate queries, so they should be wrapped in `prisma.$transaction`. Cancellation also skips the version check.
- **Fare is slab-based and the client picks the slab.** The server should compute distance from the coordinates and choose the slab itself (`findSlab` already exists).
- **The JWT is in the SSE query string**, so it can end up in access logs. Short-lived stream tokens or cookie auth would avoid that.
- **"Today"** for shift state uses the server's local timezone.
- **No CI yet.** The next step is a GitHub Actions workflow running `npm test` plus a compose-based integration run.
