# Breez Mobility

Pre-scheduled EV ride platform. Passengers book ≥ 3 h ahead, ops assigns drivers and vehicles, and drivers run battery-aware shifts with live GPS. Every state change is pushed to the right screen in real time.

**Stack:** Node 20 · Express · PostgreSQL (Prisma) · Redis · Server-Sent Events · React + Vite + Leaflet

## Design

Built on patterns from Uber, Lyft, Grab, and Bolt, adapted for a scheduled, employee-run EV fleet. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Pattern | Industry origin | In Breez |
|---|---|---|
| **Hot/cold dual store** | common to every major platform | Live location, online status, and OTPs in Redis with TTLs. Rides and audit history in Postgres. GPS pings never touch Postgres. |
| **Geospatial index** | Redis GEO | `GEOADD`/`GEOSEARCH` on `vehicles:active`, pipelined writes, TTL hashes so dead phones drop off the map |
| **Formal state machine** | Uber Fulfillment | `BOOKED → ASSIGNED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED`, plus **geofence guards** (≤ 50 m to start, ≤ 300 m to complete) |
| **No double assignment** | ride-hailing concurrency practice | Optimistic `version` column (409 on conflict) + ±2 h schedule-conflict check |
| **Idempotency keys** | Uber post-mortems | Per-user Redis `SET NX` claim, 24 h replay, 5xx not cached |
| **Append-only ride events** | event sourcing | `ride_events` audit trail behind every ride timeline |
| **Cross-node real-time fan-out** | Socket.IO Redis adapter | SSE + Redis `PSUBSCRIBE`, so any API instance can deliver any event |
| **Marketplace simulation** | Lyft SimulatedRides | `simulation/` drives 100 rides end to end through the public API |

**Deliberate differences from on-demand ride hailing:** human dispatch instead of batch matching (hours of lead time, employee drivers), and SSE instead of WebSockets (push only goes server → client; actions stay as REST calls with auth and idempotency).

## Run it

```bash
docker compose up --build                          # client :5173 · api :3000 · live fleet map :3000/map.html
docker compose --profile simulation up --build     # + 100-ride simulation
```

Three images: `Dockerfile` (API: runs migrations, optional seed, non-root, healthcheck), `client/Dockerfile` (Vite build → nginx, which proxies the API and SSE), and `simulation/Dockerfile`.

**Logins:** super admin `+919999000001` / `0000` · drivers `BRZ0001`–`BRZ0030` / `1234` (assign a vehicle in Manager → Fleet first) · passengers: any phone, and the OTP is returned in dev mode.

**Local dev:** `docker compose up -d postgres redis`, `cp .env.example .env`, `npm i && npm run db:migrate && npm run seed && npm start`, then `cd client && npm i && npm run dev`.

**Tests:** `npm test` (unit) · `npm run test:integration` (full ride lifecycle against a running stack)

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Datastores |
| `JWT_SECRET` | **Required in production.** The API won't boot with the dev default. |
| `NODE_ENV` | `development` returns OTP codes in the response |
| `CORS_ORIGIN` | Comma-separated allow-list (all origins when unset) |
| `SEED_ON_START` | `true` seeds demo data on container start (idempotent) |
| `API_UPSTREAM` | Client container: where nginx proxies the API |

## API

JWT via `Authorization: Bearer`, or `?token=` on SSE streams. Access rules: passengers see their own rides, drivers see rides assigned to them, admins see everything.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/send-otp` · `/verify-otp` · `/driver-login` · `/admin-login` |
| Rides | `POST /rides` · `GET /rides[/:id]` · `PATCH /rides/:id/status` (assigned driver) · `PATCH /rides/:id/cancel` |
| Driver | `GET /drivers/shift-state` · `POST /drivers/battery-log` · `/online` · `/offline` · `/start-charging` · `/end-charging` · `/location` · `GET /drivers/assignments` |
| Admin | `GET /admin/queue` · `/active-rides` · `/completed-rides` · `/fleet` · `/events` · `POST /admin/assign` · `/reassign` · `/cancel-ride` · CRUD for drivers, vehicles, and slabs |
| Live | `GET /events/ride/:id` · `/events/driver/:id` · `/events/fleet` (admin) |

## Roadmap

Transactional outbox for ride writes and their events · OTP rate limiting and hashed PINs · OpenTelemetry tracing · auto-suggest the nearest vehicle using `GEOSEARCH` · H3 demand heatmap · Redis and advisory locks once assignment is automated.
