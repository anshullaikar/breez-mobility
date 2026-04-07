---
name: breez-mobility
description: Working guide for the Breez Mobility codebase, a pre-scheduled EV ride platform built on Express, Prisma/Postgres, Redis, SSE, and React. Use when changing ride, driver, or admin logic, adding endpoints or live events, touching the schema, or running and deploying the stack.
---

# Breez Mobility: codebase guide

Read this before changing code. `docs/ARCHITECTURE.md` explains which ride-hailing industry patterns the design follows, and where it deliberately departs from them; `README.md` covers setup. Before adding infrastructure (locks, queues, outbox, tracing), check the roadmap in `docs/ARCHITECTURE.md` §11.

## Mental model

Three user roles, three client apps, one API:

| Role | Client route | Does |
|---|---|---|
| `PASSENGER` | `/passenger` | OTP login, book a ride ≥ 3 h ahead, track it live, cancel it (not within 2 h of pickup) |
| `DRIVER` | `/driver` | PIN login, battery logs, go online, stream GPS, move rides through the state machine, charge |
| `ADMIN` / `SUPER_ADMIN` | `/manager` | queue, assign, reassign, cancel; fleet map; driver, vehicle, and slab CRUD (slab writes are SUPER_ADMIN only) |

Data flow for every mutation:

```
REST handler → validate (role, ownership, state machine, geofence)
             → Postgres write (optimistic version check where it matters)
             → append ride_events row (for ride transitions)
             → publish(channel, event, data) → Redis → every API instance → SSE clients
```

## File map

| Path | What's there | Touch it when |
|---|---|---|
| `src/server.js` | app wiring, CORS, static `public/`, `/health`, error handler, SSE init | adding a router or global middleware |
| `src/config/database.js` | shared `PrismaClient` | never create another client |
| `src/config/redis.js` | `redis` (commands) and `redisSub` (subscriber only) | never run commands on `redisSub` |
| `src/middleware/auth.js` | `generateToken`, `auth`, `requireRole(...roles)` | changing JWT claims or expiry |
| `src/middleware/asyncRouter.js` | Router that forwards async rejections to `next(err)` | always build routers with `asyncRouter()` |
| `src/middleware/idempotent.js` | `X-Idempotency-Key` handling (per user, SET NX, no 5xx caching) | put it **after** `auth` on retry-prone mutations |
| `src/services/stateMachine.js` | `RIDE_TRANSITIONS`, `canTransition`, `BATTERY_SEQUENCE`, `findSlab`, booking and cancel windows | changing ride lifecycle rules |
| `src/services/access.js` | `ADMIN_ROLES`, `isAdmin`, `canViewRide` | changing who can see or act on a ride |
| `src/sse/manager.js` | `initSSE`, `publish`, `subscribe`, 30 s heartbeat | changing the event transport |
| `src/routes/auth.js` | OTP send/verify, driver login, admin login | |
| `src/routes/rides.js` | book, list, detail, status transition (geofence + lock), cancel | |
| `src/routes/drivers.js` | shift-state, battery-log, online/offline, charging, location, assignments, nearby | |
| `src/routes/admin.js` | queue, assign/reassign/cancel, fleet, CRUD, completed rides, events feed | |
| `src/routes/events.js` | SSE endpoints with subscribe-time authorization | adding a new stream |
| `prisma/schema.prisma` | models: User, Vehicle, FareSlab, Ride, RideEvent, BatteryLog | then add a migration (see below) |
| `prisma/migrations/` | versioned SQL; `0_init` is the baseline | |
| `prisma/seed.js` | idempotent upserts of demo data | |
| `client/src/lib/api.js` | `api(method, path, body, token)`, `subscribeSSE` | |
| `client/src/lib/auth.jsx` | `AuthProvider` (sessionStorage), `login(type, creds)` | |
| `client/src/hooks/useSSE.js` | `useSSE(channelPath, handlers, deps)` | |
| `client/src/pages/*.jsx` | `Login`, `Passenger`, `Driver`, `Manager` | UI work |
| `client/src/components/` | `PassengerMap`, `DriverMap`, `AddressSearch`, shadcn-style `ui/*` | |
| `client/nginx/default.conf.template` | prod static serving + API/SSE proxy | adding a new top-level API path |
| `public/map.html` | standalone admin fleet map (served by the API) | |
| `simulation/run.js` | end-to-end load generator over the public API | changing API contracts it uses |
| `tests/` | `node:test` unit (`stateMachine`, `access`, `asyncRouter`) + `lifecycle` integration | |

## Conventions

- **Routers:** `const router = asyncRouter();`. Handlers are `async (req, res)`; existing handlers wrap their body in `try/catch` with `console.error('[Area:action]', err)` and return a specific 500 message. Match that style.
- **Errors:** always `{ error: '<human message>' }`. Use 400 for validation, 401 for auth, 403 for role or ownership, 404 for not found (also for rides the user can't see), and 409 for version or idempotency conflicts and scheduling clashes.
- **Middleware order:** `auth, requireRole(...), idempotent(), handler`.
- **Ride writes:**
  1. check `canTransition(ride.status, next)`
  2. `updateMany({ where: { id, version }, data: { ..., version: version + 1 } })` → 409 if `count === 0`
  3. `prisma.rideEvent.create({ fromState, toState, actor: req.user.id, metadata })`
  4. `publish` to `ride:{id}`, `fleet`, and `driver:{driverId}` as relevant
- **Vehicle status side effects:** EN_ROUTE sets the vehicle to `ON_RIDE`. COMPLETED and any cancellation set it to `AVAILABLE`. Offline sets `OFFLINE`, and start-charging sets `CHARGING`.
- **Location:** stored per **vehicle** in `vehicle:{id}:loc` (hash, 120 s TTL) and the `vehicles:active` GEO set. Each ping also refreshes `driver:{id}:online` (60 s TTL).
- **Soft deletes:** drivers become `active: false`, vehicles go `OFFLINE` with no driver, slabs become `active: false`. Never hard-delete rows that rides reference.
- **Money:** `price` and `fare` are integers in **paise** (15000 = ₹150).
- **Time:** booking needs `scheduledAt ≥ now + 3 h`. Passenger cancels need `≥ 2 h` before pickup. "Today" uses the server's local midnight.
- **Client:** relative URLs only (`BASE = ''`). Vite proxies in dev and nginx proxies in prod.

## Recipes

### Add a ride state
1. Add it to `enum RideStatus` in `schema.prisma` and create a migration.
2. Add edges in `RIDE_TRANSITIONS`, and extend `tests/stateMachine.test.js`.
3. Handle any side effects (vehicle status, timestamps, geofence) in `PATCH /rides/:id/status`.
4. Update `NEXT_STATUS` and the labels in `client/src/pages/Driver.jsx`, and the status badges in `Manager.jsx` and `Passenger.jsx`.
5. Update the transition drawing in `docs/ARCHITECTURE.md`.

### Add a live event
1. Call `publish(channel, 'event_name', payload)` after the Postgres write succeeds.
2. On the client, add `event_name: (data) => …` to the relevant `useSSE` handler map.
3. For a new channel **prefix**, add it to the `psubscribe` in `sse/manager.js`, add an authorized route in `routes/events.js`, and add the path to the nginx `/events/` location if it needs to be proxied.

### Add an endpoint
Pick the router by role, use `auth` + `requireRole`, check ownership with `services/access.js`, add the path to the README API table, and add a proxy rule in `client/vite.config.js` and the nginx template if it's a new top-level prefix.

### Change the schema
```bash
# edit prisma/schema.prisma, then against a dev DB:
npx prisma migrate dev --name <change>
# commit prisma/migrations/<timestamp>_<change>/
```
Containers apply migrations on start (`scripts/start.sh` → `prisma migrate deploy`). Don't use `db push` for anything that ships.

## Running and verifying

```bash
docker compose up --build                            # full stack: client :5173, api :3000
docker compose --profile simulation up --build       # + load simulation
npm test                                             # unit tests
npm run test:integration                             # lifecycle against API_URL (default :3000)
curl localhost:3000/health                           # {status, postgres, redis}
```

Demo credentials: drivers `BRZ0001`–`BRZ0030` / PIN `1234` (an admin must assign them a vehicle first), super admin `+919999000001` / `0000`, ops admin `+919999000002` / `0000`. Passenger OTP codes come back in the response when `NODE_ENV=development`.

## Gotchas

- `redisSub` is in subscriber mode, so any regular command on it will fail.
- Status transitions to IN_PROGRESS or COMPLETED fail without a GPS ping from the last 120 s. The simulation and integration test send pings first.
- `PATCH /rides/:id/status` is **driver only**, and only for the assigned driver. Admins use `/admin/reassign` and `/admin/cancel-ride`.
- `/admin/slabs` GET is open to every authenticated role because the passenger booking form needs it.
- In production the API throws at startup if `JWT_SECRET` is unset or still the dev default.
- An old local Postgres volume created by `db push` makes `migrate deploy` fail with P3005. Run `docker compose down -v`, or `npx prisma migrate resolve --applied 0_init`.
- `validateNextBatteryEvent`/`BATTERY_SEQUENCE` are unit-tested but not used by routes. The routes infer the event type from the shift state instead.

## Known gaps

Stubbed WhatsApp OTP, plaintext PINs, non-transactional ride write + event insert, client-chosen fare slab, JWT in the SSE query string, no CI. See also the roadmap in `docs/ARCHITECTURE.md` §11.
