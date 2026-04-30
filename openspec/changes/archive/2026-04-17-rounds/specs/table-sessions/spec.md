## MODIFIED Requirements

### Requirement: Only OPEN sessions accept new diners and cart items
The system SHALL reject registration of new diners, insertion of cart items, **or creation of rounds** into any session whose `status` is not `OPEN`. Attempts MUST return HTTP 409 with an explanatory message. The gate for round creation is enforced in `RoundService._create_round()` and applies to BOTH `POST /api/diner/rounds` and `POST /api/waiter/sessions/{session_id}/rounds`.

#### Scenario: Diner cannot join a PAYING session
- **WHEN** a join request is made for a session with `status='PAYING'`
- **THEN** the system SHALL return 409 with a message indicating the table is already in billing

#### Scenario: Diner cannot join a CLOSED session
- **WHEN** a join request is made for a session with `status='CLOSED'`
- **THEN** the system SHALL return 409 with a message indicating the table is closed

#### Scenario: Cart item cannot be added after request-check
- **WHEN** a cart item creation is attempted on a session with `status='PAYING'`
- **THEN** the service SHALL raise a conflict error (HTTP 409)

#### Scenario: Round cannot be created on a PAYING session
- **WHEN** a diner or waiter attempts to create a round on a session with `status='PAYING'`
- **THEN** the service SHALL return HTTP 409 AND no Round row SHALL be persisted

#### Scenario: Round cannot be created on a CLOSED session
- **WHEN** a diner or waiter attempts to create a round on a session with `status='CLOSED'`
- **THEN** the service SHALL return HTTP 409 AND no Round row SHALL be persisted

## ADDED Requirements

### Requirement: TableSession exposes a rounds relationship
The `TableSession` ORM class SHALL expose a `rounds: list[Round]` relationship back-populated from `Round.session`. This is an ORM-only addition — no schema change is required because the FK already lives on `Round.session_id` (introduced by the `rounds` capability). The relationship SHALL default to `lazy="select"` and MUST NOT be cascaded on session delete (rounds survive the session soft-delete by design; they're referenced by billing later).

#### Scenario: session.rounds returns the rounds for the session
- **WHEN** a TableSession has 3 rounds persisted with its `id` in `Round.session_id`
- **THEN** accessing `session.rounds` SHALL return those 3 rounds

#### Scenario: Deleting a session does not cascade to rounds
- **WHEN** `TableSessionService.close()` soft-deletes a session
- **THEN** its rounds SHALL NOT be soft-deleted or hard-deleted by cascade
