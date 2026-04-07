# Architecture

This document explains *why* Breez Mobility is built the way it is. The README covers *how* to run it.

## 1. Problem shape

Breez runs **pre-scheduled** EV rides with a company-owned fleet. That differs from Uber-style on-demand matching:

- Rides are booked ≥ 3 hours ahead, so assignment is a **human ops decision** (the admin queue), not a real-time matching algorithm.
- Drivers are employees on shifts, and vehicles are shared EVs. Battery state (SOC) is a first-class concern: drivers log it at vehicle pickup, after rides, and around charging.
- Correctness matters more than raw throughput. The system must never double-assign a ride, let a ride skip states, or let a driver "complete" a trip from home.

## 2. Components

| Component | Tech | Responsibility |
|---|---|---|
| **app** | Express 4, Prisma, ioredis | REST API, business rules, publishing events |
| **client** | React 18, Vite, Tailwind, Leaflet; nginx in prod | Three role-specific apps: passenger, driver, manager |
| **postgres** | PostgreSQL 16 | Durable state: users, vehicles, rides, ride_events, battery_logs, fare_slabs |
| **redis** | Redis 7 | Ephemeral and hot state, plus pub/sub |
| **simulation** | Plain Node script | Drives the whole system end to end as a load and demo tool |

nginx in the client container proxies API and SSE paths to the app, so the browser only ever talks to one origin. That means no CORS in production and relative URLs in the client (`BASE = ''` in `client/src/lib/api.js`).

## 3. Dual store: what lives where

| Data | Store | Key / table | Lifetime |
|---|---|---|---|
| Rides, users, vehicles, slabs | Postgres | tables | permanent |
| Ride transitions | Postgres | `ride_events` (append-only) | permanent |
| Battery logs | Postgres | `battery_logs` | permanent |
| Latest vehicle position | Redis hash | `vehicle:{id}:loc` → `{lat,lng,ts,driverId}` | 120 s TTL |
| Geo index | Redis GEO | `vehicles:active` | removed when the driver goes offline |
| Driver online flag | Redis string | `driver:{id}:online` | 60 s TTL, refreshed by each GPS ping |
| OTP codes | Redis string | `otp:{phone}` | 300 s TTL |
| Idempotency results | Redis string | `idempotency:{userId}:{key}` | 60 s while pending, 24 h once done |

**Rule of thumb:** if losing it would be a business problem, it goes in Postgres. If it's replaced every few seconds anyway, it goes in Redis with a TTL, so stale data expires by itself. The "online" flag works as a heartbeat: when a phone dies, the driver drops offline after 60 s with no cleanup job.

Location is stored **per vehicle**, not per driver. The car is what's on the map, and a vehicle can change drivers between shifts.

## 4. Ride state machine

```
BOOKED ──assign──► ASSIGNED ──► EN_ROUTE ──► ARRIVED ──► IN_PROGRESS ──► COMPLETED
   │                  │
   └──── cancel ──────┴──► CANCELLED
```

Defined as data in `src/services/stateMachine.js` (`RIDE_TRANSITIONS`). Every mutation goes through `canTransition(from, to)`. Admin paths are the exception and are deliberately separate endpoints:

- `/admin/reassign` moves ASSIGNED or EN_ROUTE back to ASSIGNED with a new driver.
- `/admin/cancel-ride` cancels any non-terminal ride (passengers can only cancel from BOOKED or ASSIGNED, and not within 2 h of pickup).

**Geofence gates** in `PATCH /rides/:id/status`:

| Transition | Requirement |
|---|---|
| ARRIVED → IN_PROGRESS | vehicle ≤ **50 m** from pickup |
| IN_PROGRESS → COMPLETED | vehicle ≤ **300 m** from drop-off (looser, since drop-off points are less precise) |

The position comes from Redis (`vehicle:{id}:loc`). If there's no recent ping, the transition is refused, which forces GPS to be on.

## 5. Concurrency and retries

**Optimistic locking.** `rides.version` is incremented on every write. Assign and status updates use

```js
prisma.ride.updateMany({ where: { id, version: expected }, data: { ..., version: expected + 1 } })
```

and return **409** if `count === 0`. Two admins assigning the same ride at once: one wins, the other gets a conflict and re-fetches. There are no row locks and no long transactions.

**Assignment conflicts.** Before assigning, the API checks that the driver has no non-terminal ride within ±2 h of the scheduled time.

**Idempotency** (`src/middleware/idempotent.js`). Clients send `X-Idempotency-Key` on booking and status changes.
1. `SET key __pending__ NX EX 60` atomically claims the key.
2. If the claim fails and the value is still pending: **409** (a duplicate request is in flight).
3. If it fails and there's a cached result: replay the same status and body.
4. On completion, cache the response for 24 h. **5xx responses are not cached**, so the client can retry them.

Keys are scoped per user, so one user can never receive another user's cached response.

## 6. Real-time: SSE + Redis pub/sub

```
route handler ──publish(channel, event, data)──► Redis PUBLISH
                                                    │
     every API instance: PSUBSCRIBE ride:* driver:* fleet
                                                    │
                        in-memory Map<channel, Set<res>> ──► res.write("event: …\ndata: …")
```

- **Why SSE and not WebSockets?** All traffic here is server → client. Client → server actions are ordinary REST calls, which already get auth, idempotency, and validation. SSE runs over plain HTTP, reconnects automatically in the browser, and works through proxies with buffering turned off (see `client/nginx/default.conf.template`).
- **Why Redis pub/sub?** SSE connections are held in each process's memory. With more than one API instance, the instance handling a REST mutation usually isn't the one holding the subscriber's connection. Redis fans each event out to every instance, and each one delivers to its local connections.
- A **separate Redis connection** is used for subscribing, because a connection in subscriber mode can't run normal commands.
- **Heartbeats** (`:heartbeat` comment every 30 s) keep idle connections from being cut by proxies and load balancers.
- **Authorization** is checked when a client subscribes (`src/routes/events.js` + `src/services/access.js`): ride streams go to the ride's participants and admins, driver streams to that driver, and the fleet stream to admins only.

Channels:

| Channel | Publishers | Subscribers |
|---|---|---|
| `ride:{id}` | status changes, assignment, driver location during the ride, cancellation | passenger tracking view |
| `driver:{id}` | assignment, reassignment, admin cancellation | driver app |
| `fleet` | everything ops cares about | manager dashboard, `public/map.html` |

## 7. Driver shift state

`GET /drivers/shift-state` computes the single thing the driver app should show next, so the UI never has to piece together business rules on its own:

```
NO_VEHICLE ─(admin assigns vehicle)─► NEEDS_PICKUP_LOG ─(battery log)─► OFFLINE ⇄ ONLINE
                                                                           │
                                             ride assigned & in progress ──► ON_RIDE
                                                                           │
                                       ride completed, no newer drop log ──► NEEDS_POSTRIDE_LOG ─(battery log)─► ONLINE/OFFLINE
                                          start-charging ──► CHARGING ─(end-charging)─► …
```

`POST /drivers/battery-log` infers the event type (`VEHICLE_PICKUP` if none today, otherwise `VEHICLE_DROP`), so the driver only ever enters an SOC number. Going online requires today's pickup log. SOC below 20% publishes `low_battery_alert` to the fleet channel.

## 8. Auth and access control

- JWTs (14 h, roughly one shift) carry `{ id, role, phone }`. `auth` accepts `Authorization: Bearer` or `?token=` (for SSE).
- `requireRole(...)` handles role gates, and `src/services/access.js` handles ownership: a user can see a ride if they are an admin, its passenger, or its driver. Ride detail returns **404** rather than 403 to other users, so ride IDs can't be probed.
- In production the API refuses to start unless `JWT_SECRET` is set to a non-default value.

## 9. Error handling

Express 4 doesn't catch rejected promises from async handlers. On Node 20+, an unhandled rejection kills the process. Every router is created with `asyncRouter()` (`src/middleware/asyncRouter.js`), which forwards rejections to `next(err)`. A final error middleware in `server.js` logs the error and returns a generic 500.

## 10. Deployment shape

Three images, one per service:

| Image | Dockerfile | Notes |
|---|---|---|
| api | `Dockerfile` | multi-stage, prod deps only, non-root, `HEALTHCHECK`, runs `prisma migrate deploy` then (optionally) seed |
| client | `client/Dockerfile` | Vite build → nginx; `API_UPSTREAM` env var sets the proxy target |
| simulation | `simulation/Dockerfile` | only `run.js`; point `API_URL` at the API |

The API is stateless apart from open SSE connections, and Redis pub/sub covers those, so it scales horizontally. Schema changes go through Prisma migrations (`prisma/migrations`), not `db push`.

## 11. Trade-offs and next steps

| Decision | Trade-off accepted | What would change it |
|---|---|---|
| Slab fares chosen by the client | simple, but trusts the client | compute distance server-side and call `findSlab` |
| Ride update and event insert as separate queries | a crash between them loses one event row | wrap in `prisma.$transaction` |
| Redis pub/sub is fire-and-forget | a client that is disconnected misses events and refetches on reconnect | Redis Streams with `Last-Event-ID` replay |
| Plaintext PINs | fine for a demo seed | bcrypt/argon2 + rate limiting |
| Token in the SSE query string | may show up in access logs | short-lived stream tokens or cookies |
| Human assignment | matches the pre-scheduled business | auto-suggest the nearest available vehicle using `GEOSEARCH` on `vehicles:active` |
