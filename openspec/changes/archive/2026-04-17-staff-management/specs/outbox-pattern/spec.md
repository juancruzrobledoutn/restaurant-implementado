## ADDED Requirements

### Requirement: OutboxEvent model
The system SHALL store pending-to-publish events in table `outbox_event` with fields: `id` (BigInteger PK), `event_type` (String 100, not null), `payload` (JSONB, not null), `created_at` (DateTime, default now()), `processed_at` (DateTime, nullable — NULL means pending). Indexes on `processed_at` (partial index where `processed_at IS NULL`) for fast polling by the future worker, and on `(event_type, created_at)`.

#### Scenario: Insert an outbox event
- **WHEN** a row is inserted with `event_type="CHECK_REQUESTED", payload={"check_id": 42}`
- **THEN** the row SHALL be persisted with `processed_at=NULL` and `created_at=now()`

#### Scenario: Mark event as processed
- **WHEN** `UPDATE outbox_event SET processed_at = now() WHERE id = 1`
- **THEN** the row SHALL reflect the new `processed_at` and the partial index SHALL no longer include it

---

### Requirement: OutboxService.write_event
The system SHALL provide an `OutboxService` (stateless helper) with a single method `write_event(db: Session, event_type: str, payload: dict) -> OutboxEvent`. The method MUST insert the row in the provided session WITHOUT calling commit — the caller is responsible for committing (typically via `safe_commit(db)` at the end of the domain service). This guarantees atomicity: the event is inserted in the same transaction as the business data.

#### Scenario: write_event inserts without commit
- **WHEN** `OutboxService.write_event(db, "ROUND_SUBMITTED", {"round_id": 7})` is called
- **THEN** the method SHALL execute `db.add(OutboxEvent(...))` and return the in-memory instance
- **AND** the method SHALL NOT call `db.commit()` — the transaction remains open

#### Scenario: Atomicity with business data
- **WHEN** a domain service performs `db.add(Round(...))`, then `OutboxService.write_event(db, "ROUND_SUBMITTED", ...)`, then `safe_commit(db)`
- **THEN** both rows (round + outbox_event) SHALL be persisted atomically — either both or neither

#### Scenario: Rollback on business error
- **WHEN** a domain service calls `write_event` and then an exception occurs before commit
- **THEN** `safe_commit` SHALL rollback and NEITHER the business row NOR the outbox event are persisted

#### Scenario: Event payload is JSON-serializable
- **WHEN** `write_event(db, "X", payload={"foo": date(2026, 4, 17)})` is called with a non-JSON-serializable value
- **THEN** the service SHALL raise `ValueError` with a clear message BEFORE `db.add`

---

### Requirement: Documented contract for future worker
The system SHALL document the contract that a future worker (in change C-09 or C-10) will fulfill: (1) poll `SELECT ... WHERE processed_at IS NULL ORDER BY id LIMIT 100` at a regular interval, (2) publish each event to its corresponding Redis Stream, (3) set `processed_at = now()` on success, (4) failed events after N retries go to a DLQ. THIS CHANGE DOES NOT IMPLEMENT THE WORKER — only the table + writer.

#### Scenario: Contract documented in OutboxService docstring
- **WHEN** a developer reads the docstring of `OutboxService.write_event`
- **THEN** it SHALL state explicitly "This change provides only the writer. The background processor that publishes to Redis Streams is implemented in a later change."

#### Scenario: No processor running means events accumulate
- **WHEN** `write_event` is called repeatedly without a worker running
- **THEN** rows SHALL accumulate with `processed_at = NULL` (acceptable until the worker is deployed)
