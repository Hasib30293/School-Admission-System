# AI usage

This project was developed with OpenAI Codex assistance. AI was used for scaffolding, API/UI implementation, Docker configuration, and test design. Big Pickle from OpenCode was also used for follow-up implementation, compliance review, admin edit/delete features, the local development launcher, UI translation, and the frontend Vitest + React Testing Library tests.

The generated code was then reviewed and run manually. Issues found and fixed during that review:

- The test project did not compile: `backend.tests` was missing implicit usings and the `Xunit` using, so `dotnet test` failed before running anything.
- Confirming or cancelling another student's hold returned HTTP 500, because `Results.Forbid()` requires authentication services that the app does not register. Replaced with an explicit 403 JSON result.
- The API rejected duplicate class names with 409 via a unique index that the brief never requires, which could break repeated automated test runs. Removed the uniqueness (and made startup normalise any old database volume).
- The UI did not show each class's total seat count, and the "Pay admission fee" button stayed enabled after a hold expired locally. Both were fixed, and network errors now show a readable message.
- `docker compose` builds had no `.dockerignore`, so a host `node_modules`/`bin`/`obj` could leak into the Linux images; added one.

The important correctness decisions were reviewed manually: the PostgreSQL row lock is held for the complete seat-allocation transaction, active-student uniqueness is enforced in the database, confirmation checks ownership and expiry, and the concurrency test asserts capacity rather than merely checking response counts.
