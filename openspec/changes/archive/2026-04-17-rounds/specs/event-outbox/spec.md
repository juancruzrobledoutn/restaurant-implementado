## ADDED Requirements

### Requirement: OutboxService.write_event
The system SHALL provide `OutboxService.write_event(db, event_type: str, payload: dict) -> OutboxEvent` that inserts an `OutboxEvent` row into the database session via `db.add(...)` WITHOUT flushing or committing. The caller MUST own the `safe_commit(db)` that persists the row atomically with the business operation. `payload` MUST be JSON-serializable — the service MUST validate this via `json.dumps(payload)` before `db.add()` and raise `ValidationError("non_serializable_payload")` on failure.

#### Scenario: write_event adds a row to the session
- **WHEN** `OutboxService.write_event(db, "ROUND_SUBMITTED", {"round_id": 5})` is called
- **THEN** a new `OutboxEvent` instance SHALL be added to `db`'s pending additions with `event_type="ROUND_SUBMITTED"` and `payload={"round_id": 5}` AND `processed_at=NULL`

#### Scenario: write_event does not commit
- **WHEN** `OutboxService.write_event(db, ...)` is called
- **THEN** the database SHALL NOT contain the new row until the caller invokes `safe_commit(db)`

#### Scenario: Non-serializable payload rejected
- **WHEN** `OutboxService.write_event(db, "X", {"d": datetime(2026,1,1)})` is called (datetime is not JSON-serializable without a custom encoder)
- **THEN** the service SHALL raise `ValidationError("non_serializable_payload")` AND SHALL NOT add anything to the session

#### Scenario: Atomic with the business operation
- **WHEN** `OutboxService.write_event` is called followed by a business INSERT AND `safe_commit(db)` fails
- **THEN** neither the outbox row nor the business INSERT SHALL persist (all-or-nothing rollback)

#### Scenario: Atomic success
- **WHEN** `OutboxService.write_event` is called followed by a business INSERT AND `safe_commit(db)` succeeds
- **THEN** both rows SHALL be visible in the database

---

### Requirement: Outbox worker publishes pending events
The system SHALL run a background worker that polls the `outbox_event` table for rows where `processed_at IS NULL`, publishes each to Redis via `publish_event(channel, payload)`, and sets `processed_at = now()` on success. The worker MUST process in FIFO order (`ORDER BY created_at ASC, id ASC`), batch size `OUTBOX_BATCH_SIZE` (default 50), and poll every `OUTBOX_WORKER_INTERVAL_SECONDS` (default 2). On publish failure, the worker MUST leave `processed_at=NULL` so the event is retried on the next poll.

#### Scenario: Pending events are published
- **WHEN** an `OutboxEvent` with `event_type='ROUND_SUBMITTED'` is committed with `processed_at=NULL` AND the worker polls
- **THEN** `publish_event(...)` SHALL be called with the row's event_type and payload AND the row's `processed_at` SHALL be updated to a non-NULL timestamp

#### Scenario: Processed events are not republished
- **WHEN** an `OutboxEvent` with `processed_at != NULL` exists AND the worker polls
- **THEN** `publish_event(...)` SHALL NOT be called for that row

#### Scenario: Publish failure leaves row pending
- **WHEN** `publish_event(...)` raises an exception for a pending row
- **THEN** the row's `processed_at` SHALL remain NULL AND the next poll SHALL retry the row

#### Scenario: Batch processing respects OUTBOX_BATCH_SIZE
- **WHEN** 100 pending rows exist AND `OUTBOX_BATCH_SIZE=50`
- **THEN** one poll SHALL publish exactly 50 rows (the oldest 50), and the next poll SHALL handle the remaining 50

#### Scenario: FIFO ordering by (created_at, id)
- **WHEN** rows A (created_at=t1, id=2) and B (created_at=t1, id=1) and C (created_at=t0, id=3) are pending
- **THEN** the worker SHALL publish in order: C, B, A

---

### Requirement: Outbox worker lifecycle
The system SHALL start the outbox worker during FastAPI `lifespan` startup and stop it during `lifespan` shutdown. On shutdown, the worker MUST finish its current batch before returning (graceful drain with a configurable timeout, default 10s). On startup failure (e.g. Redis unavailable), the application MUST log the error and continue — the worker's failure MUST NOT block the REST API from serving requests.

#### Scenario: Worker starts with the app
- **WHEN** `rest_api` starts via `uvicorn ... rest_api.main:app`
- **THEN** the lifespan startup SHALL invoke `start_worker(app)` AND the worker SHALL begin polling within `OUTBOX_WORKER_INTERVAL_SECONDS`

#### Scenario: Worker stops gracefully on shutdown
- **WHEN** the app receives SIGTERM
- **THEN** the lifespan shutdown SHALL invoke `stop_worker(app)` AND any batch in progress SHALL complete before `stop_worker` returns (up to 10s)

#### Scenario: Worker failure does not block REST API
- **WHEN** Redis is unreachable at startup
- **THEN** the REST API SHALL still respond to `GET /health` with HTTP 200 AND the worker SHALL log errors and continue retrying

---

### Requirement: Outbox integration with RoundService
`RoundService.submit()` and `RoundService.mark_ready()` SHALL call `OutboxService.write_event(db, ...)` BEFORE calling `safe_commit(db)`. No other Round transitions SHALL write to the outbox — they use Direct Redis via `publish_event()` AFTER commit. The outbox row's `payload` MUST contain `{round_id, session_id, branch_id, tenant_id, status, timestamp}` at minimum.

#### Scenario: submit() writes to outbox before commit
- **WHEN** `RoundService.submit()` runs on a CONFIRMED round
- **THEN** `OutboxService.write_event(db, "ROUND_SUBMITTED", ...)` SHALL be invoked before `safe_commit(db)`

#### Scenario: mark_ready() writes to outbox before commit
- **WHEN** `RoundService.mark_ready()` runs on an IN_KITCHEN round
- **THEN** `OutboxService.write_event(db, "ROUND_READY", ...)` SHALL be invoked before `safe_commit(db)`

#### Scenario: confirm() does not write to outbox
- **WHEN** `RoundService.confirm()` runs on a PENDING round
- **THEN** no `OutboxEvent` row SHALL be written — the event is published Direct Redis via `publish_event(...)` AFTER commit

#### Scenario: Rollback removes outbox row
- **WHEN** `RoundService.submit()` writes the outbox event AND `safe_commit(db)` fails
- **THEN** no `OutboxEvent` row SHALL exist after rollback
