# AI usage

This project was developed with OpenAI Codex assistance. AI was used for scaffolding, API/UI implementation, Docker configuration, and test design.

The important correctness decisions were reviewed manually: the PostgreSQL row lock is held for the complete seat-allocation transaction, active-student uniqueness is enforced in the database, confirmation checks ownership and expiry, and the concurrency test asserts capacity rather than merely checking response counts.

