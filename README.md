**Live demo:** https://school-admission-system-nu.vercel.app
# School Admission System

A Dockerized school admission system  It provides a .NET 8/PostgreSQL API and a React/Vite UI for first-come-first-served seat holds.


## Run

```bash
docker compose up --build
```

Open http://localhost:3000. The API is available at http://localhost:8080.

The database is persisted in the `postgres-data` Docker volume. Configure `HOLD_DURATION_SECONDS` in `docker-compose.yml` (default: 600).

On first start against an empty database, the API seeds six classes (Play Group through Class 10) and fourteen students with confirmed, pending, and held applications, so the UI is populated immediately. Remove the `postgres-data` volume to start from a clean database.

The frontend calls the API through its own origin: nginx proxies `/classes`, `/holds`, `/admin`, `/me` and `/health` to the `backend` service, so `http://localhost:3000` works without any CORS or host/port setup. To point the UI at a different backend, build with `VITE_API_URL` set to that backend's full URL (e.g. `VITE_API_URL=http://example.com:8080 docker compose build frontend`); when it is empty the proxy is used. The backend itself is still exposed at `http://localhost:8080`.

## Local development (one command)

`docker compose up --build` above already runs the database, API and UI together. To run the app as native processes instead (requires the .NET 8 SDK, Node 18+, and either Docker or a local PostgreSQL on `localhost:5432`):

```powershell
.\dev.ps1
```

The script starts PostgreSQL (via Docker when available), the API on http://localhost:8080 in one window, and the Vite UI on http://localhost:5173 in another. Close those windows to stop.

## Test

```bash
dotnet test backend.tests/backend.tests.csproj
```

Run the test command while PostgreSQL is available (for example after `docker compose up -d postgres`; the Compose file publishes it on `localhost:5432`). Set `TEST_CONNECTION` if the database is not using the Compose defaults.

The backend test suite includes API contract tests, ownership/idempotency tests, expiry behavior, and a concurrent hold test proving that capacity is never exceeded.

### Frontend

```bash
cd frontend
npm install
npm test
```

The Vitest + React Testing Library suite covers class listing and seat counts, the disabled apply button when a class is full, expired holds showing `EXPIRED` with a disabled pay button, the unreachable-server message, and the admin create-class flow.

## API

All student-specific requests use the `X-Student-Id` header. The required routes are implemented exactly as specified:

- `POST /classes`
- `GET /classes`
- `GET /classes/{classId}`
- `POST /classes/{classId}/holds`
- `GET /holds/{holdId}`
- `POST /holds/{holdId}/confirm`
- `DELETE /holds/{holdId}`
- `GET /me/holds`

`POST /holds/{holdId}/confirm` records the payment method and transaction ID and moves the application to `PENDING`; it does not confirm the admission. An admin must verify the transaction ID before the seat becomes `CONFIRMED`. Student contact numbers must be exactly 11 digits.

Admin convenience endpoints (not part of the required contract): `PUT /classes/{classId}` updates a class name/seat count (seat count cannot drop below the seats currently held, awaiting approval or confirmed), and `DELETE /classes/{classId}` deletes a class and its applications. Payment verification uses `GET /admin/payments/pending`, `POST /holds/{holdId}/approve` and `POST /holds/{holdId}/reject` (an optional `{ "note": "..." }` body is stored with the decision). They are used by the "Admin" tab.

## Design notes

Seat allocation is serialized per class with a PostgreSQL row lock inside a transaction. A unique partial index prevents more than one active hold, pending payment or confirmed admission for the same student/class. A hosted background service expires unpaid holds without requiring an API request; holds awaiting payment verification stay reserved until an admin approves or rejects them.

