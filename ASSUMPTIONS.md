# Assumptions

- A class/shift is represented by one `ClassOffering`; names are user-entered and therefore can include both grade and shift.
- No authentication is required. The `X-Student-Id` value is validated as exactly 17 digits and is the student's identity.
- The hold duration is configured globally with `HOLD_DURATION_SECONDS`, defaulting to 600 seconds.
- Payment is simulated: pressing confirm immediately succeeds after ownership and expiry checks.
- A student may have one active hold or confirmed admission per class, but can apply to multiple different classes.
- Admin authorization is intentionally omitted because the brief explicitly says login is not required; class creation is available from the UI.
- Expiry is persisted as a status transition by a background worker and also reconciled during relevant reads/writes, so a restarted process cannot continue treating an expired hold as active.
- PostgreSQL is the source of truth. Docker Compose uses a named volume so database contents survive container recreation.

