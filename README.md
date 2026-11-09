# School Admission System

A Dockerized school admission system built for the take-home assignment. It provides a .NET 8/PostgreSQL API and a React/Vite UI for first-come-first-served seat holds.

## Run

```bash
docker compose up --build
```

Open http://localhost:3000. The API is available at http://localhost:8080.

The database is persisted in the `postgres-data` Docker volume. Configure `HOLD_DURATION_SECONDS` in `docker-compose.yml` (default: 600).

The frontend calls the API through its own origin: nginx proxies `/classes`, `/holds`, `/me` and `/health` to the `backend` service, so `http://localhost:3000` works without any CORS or host/port setup. To point the UI at a different backend, build with `VITE_API_URL` set to that backend's full URL (e.g. `VITE_API_URL=http://example.com:8080 docker compose build frontend`); when it is empty the proxy is used. The backend itself is still exposed at `http://localhost:8080`.

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

Admin convenience endpoints (not part of the required contract): `PUT /classes/{classId}` updates a class name/seat count (seat count cannot drop below the seats currently held or confirmed), and `DELETE /classes/{classId}` deletes a class and its applications. They are used by the "Create Class (School Admin)" tab.

## Design notes

Seat allocation is serialized per class with a PostgreSQL row lock inside a transaction. A unique partial index prevents more than one active hold or confirmed admission for the same student/class. A hosted background service expires holds without requiring an API request.

