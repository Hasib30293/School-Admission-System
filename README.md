# School Admission System

A Dockerized school admission system built for the take-home assignment. It provides a .NET 8/PostgreSQL API and a React/Vite UI for first-come-first-served seat holds.

## Run

```bash
docker compose up --build
```

Open http://localhost:3000. The API is available at http://localhost:8080.

The database is persisted in the `postgres-data` Docker volume. Configure `HOLD_DURATION_SECONDS` in `docker-compose.yml` (default: 600). The frontend API URL can be changed with `VITE_API_URL`.

## Test

```bash
dotnet test backend.tests/backend.tests.csproj
```

Run the test command while the PostgreSQL service is available (for example after `docker compose up postgres -d`). Set `TEST_CONNECTION` if the database is not using the Compose defaults.

The backend test suite includes API contract tests, ownership/idempotency tests, expiry behavior, and a concurrent hold test proving that capacity is never exceeded.

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

## Design notes

Seat allocation is serialized per class with a PostgreSQL row lock inside a transaction. A unique partial index prevents more than one active hold or confirmed admission for the same student/class. A hosted background service expires holds without requiring an API request.

