# Architecture

Breez borrows the core patterns that Uber, Lyft, Grab, and Bolt have converged on, and deliberately departs from them where a **pre-scheduled, employee-run EV fleet** differs from on-demand ride hailing.

## 1. Hot path vs cold path

Every major platform separates ephemeral spatial data from durable ride state. Breez does the same:

| Redis (hot, TTL-bounded) | Postgres (cold, durable) |
|---|---|
| `vehicles:active`: GEO index | `rides`: current state + `version` |
| `vehicle:{id}:loc`: last fix, **120 s TTL** | `ride_events`: append-only log |
| `driver:{id}:online`: heartbeat, **60 s TTL** | `battery_logs`, `vehicles`, `users`, `fare_slabs` |
| `otp:{phone}` (5 min) · `idempotency:{user}:{key}` · pub/sub | |

- **GPS pings never write to Postgres.** Putting live locations in the relational DB is a well-known ride-hailing scaling trap.
- Writes on the ping path are **pipelined**: HSET + EXPIRE + GEOADD + SETEX go out in one round trip.
- **TTLs replace cleanup jobs:** a dead phone stops pinging, and the driver goes offline 60 s later.
- Location is keyed by **vehicle**, not driver. The company owns the cars and drivers rotate between shifts.
- Nearby search uses `GEOSEARCH` (the replacement for the deprecated `GEORADIUS`).

## 2. Ride state machine

Ad-hoc status updates are how ride systems end up in impossible states. Uber's Fulfillment Platform models lifecycles as explicit state machines, and so does Breez:

```
BOOKED → ASSIGNED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
   └────────┴──→ CANCELLED
```

- It's a transition table (`src/services/stateMachine.js`), not XState. The lifecycle is flat, and a table is serializable, trivial to unit-test, and returned to clients as `validTransitions`.
- **Geofence guards** check the physical world as well as legality: ≤ **50 m** from pickup to start, ≤ **300 m** from drop-off to complete. A transition is refused if there's no GPS fix in the last 120 s, which covers the "GPS stopped mid-ride" failure mode.
- Only the assigned driver can progress a ride. Admins use separate reassign and cancel endpoints. Passengers can't cancel within 2 h of pickup.

## 3. Concurrency: no double assignment

The industry answer is layered: a Redis lock as a fast gate, a Postgres advisory lock, and an optimistic version check as the final safety net.

Breez implements the **correctness layer**: `UPDATE … WHERE id = ? AND status = 'BOOKED' AND version = ?`, with **409** when no row matches. The two lock layers mainly shed load under heavy contention (an automated matcher). With human dispatchers, contention is rare. They're on the roadmap for when assignment is automated.

There's also a domain rule: a driver can't hold two open rides within **±2 h** of each other.

## 4. Idempotency

Missing idempotency on retried mobile requests is behind a large share of ride-hailing incidents (duplicate bookings, ghost rides). Clients send `X-Idempotency-Key`:

1. `SET key __pending__ NX EX 60` claims it atomically, so a concurrent duplicate gets **409** and doesn't run twice.
2. A completed response is cached for **24 h** and replayed on retry.
3. **5xx responses are not cached**, so a real failure can be retried.
4. Keys are scoped per user.

## 5. Real-time: SSE + Redis pub/sub

The usual recommendation is Socket.IO with the Redis adapter. Breez keeps the architecture and changes the transport:

- **Why SSE?** All push goes server → client. Client actions stay as REST calls, which already get auth, validation, and idempotency. `EventSource` reconnects on its own and runs over plain HTTP.
- **Cross-node delivery:** every API instance `PSUBSCRIBE`s to `ride:*`, `driver:*`, and `fleet`, then writes to its own local connections. No `user → instance` registry is needed. The cost is that every node sees every message, which is fine at fleet scale.
- A separate Redis connection handles subscribing, heartbeats go out every 30 s, and nginx disables buffering on `/events/`.
- Streams are authorized when a client subscribes: the ride stream goes to its passenger, driver, and admins, and the fleet stream to admins only.

## 6. Event log

Every transition appends `{fromState, toState, actor, metadata}` to `ride_events`. That powers the ride timeline and the ops event feed. It's an audit log **alongside** current state (`rides.status` stays the source of truth), which gets the benefits of event sourcing without a projection layer.

## 7. Driver shift state

EV fleet operations aren't covered by generic ride-hailing designs, so Breez adds a battery-aware shift flow. `GET /drivers/shift-state` returns the single next thing the driver app should show:

`NO_VEHICLE → NEEDS_PICKUP_LOG → OFFLINE ⇄ ONLINE → ON_RIDE → NEEDS_POSTRIDE_LOG`, with `CHARGING` as a side branch.

Going online requires the day's pickup battery log. The battery-log endpoint infers the event type from the shift state, so the driver only enters an SOC. SOC below 20% raises `low_battery_alert` on the fleet stream.

## 8. Where Breez differs from on-demand platforms

| On-demand practice | Breez | Why |
|---|---|---|
| Batch matching (Lyft Hungarian, Grab incremental KM) | Human dispatch queue sorted by pickup time | Hours of lead time. Ops judgment (charge level, shift end) wins at this scale. |
| Driver accept/decline with timeouts | Direct assignment | Drivers are employees, so there's nothing to time out |
| WebSockets | SSE | Push only goes one way |

The assign endpoint is where a "nearest available vehicle" suggestion (`GEOSEARCH`) plugs in without changing the rest.

## 9. Simulation

Following Lyft's approach of simulating the marketplace, `simulation/run.js` runs 30 drivers and 100 rides through the whole lifecycle, **through the public API only**: booking, assignment with conflict rejection, geofence-passing GPS pings, and battery logs. That means it exercises the same auth, state machine, idempotency, and pub/sub paths as real clients.

## 10. Operations

- Three images: API (migrations on boot, non-root, healthcheck), client (nginx proxying the API and SSE), simulation. The API is stateless apart from SSE connections, which pub/sub covers, so it scales horizontally.
- Express 4 async errors go through `asyncRouter()` to a central handler, so one failed Redis call can't crash the process.
- In production the API refuses to start without a real `JWT_SECRET`.

## 11. Roadmap

| Next | Why |
|---|---|
| Transactional outbox | The ride update, event insert, and publish aren't atomic today |
| OTP rate limits, hashed PINs | Auth hardening |
| OpenTelemetry tracing | Express → Prisma → Redis waterfalls with almost no code |
| Split GEO keys by status + nearest-vehicle suggestion | Better data behind dispatch |
| Throttled fleet updates, viewport filtering (`GEOSEARCH BYBOX`) | Dashboard fan-out as the fleet grows |
| H3 demand heatmap | Placing chargers and parking bays |
| Redis + advisory locks | Once assignment is automated |
