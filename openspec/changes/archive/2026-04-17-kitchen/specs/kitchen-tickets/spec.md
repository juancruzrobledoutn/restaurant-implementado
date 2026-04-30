## ADDED Requirements

### Requirement: Kitchen ticket data model

The system SHALL maintain two dedicated tables for kitchen work units: `kitchen_ticket` and `kitchen_ticket_item`. Each `kitchen_ticket` row represents exactly one round's worth of work for the kitchen and is uniquely associated with a `round` via a unique FK. Each `kitchen_ticket_item` row represents one non-voided `round_item` at the moment the ticket was created.

Both tables use the `AuditMixin` (soft delete via `is_active`, audit timestamps). Both tables denormalise `tenant_id` for fast scoping. `kitchen_ticket` denormalises `branch_id` for the same reason.

The `kitchen_ticket.status` column is constrained to the values `IN_PROGRESS`, `READY`, `DELIVERED` via a CHECK constraint at the DB level.

#### Scenario: Ticket table is created by migration 010

- **WHEN** Alembic migration 010_kitchen is applied
- **THEN** tables `kitchen_ticket` and `kitchen_ticket_item` exist with the columns, indexes, FKs, and CHECK constraints described in design.md §Migration Plan

#### Scenario: Invalid ticket status rejected at DB level

- **WHEN** the system attempts to insert a `kitchen_ticket` with `status='UNKNOWN'`
- **THEN** the DB raises a CHECK constraint violation and the insert fails

### Requirement: One ticket per round, created on round submission

The system SHALL create exactly one `kitchen_ticket` for every round that transitions from `CONFIRMED` to `SUBMITTED`. The creation MUST happen within the same DB transaction as the round status change, so that rolling back the round submission also removes the ticket.

The created ticket's initial status is `IN_PROGRESS`. One `kitchen_ticket_item` row is created per non-voided `round_item` belonging to the round. Voided items at submission time are NOT given ticket items.

The DB enforces the one-to-one invariant via a unique constraint on `kitchen_ticket.round_id`.

#### Scenario: Submitting a round auto-creates a ticket

- **WHEN** `RoundService.submit_round` successfully transitions a round from CONFIRMED to SUBMITTED
- **THEN** a `kitchen_ticket` row exists with `round_id = round.id`, `status = 'IN_PROGRESS'`, `branch_id = round.branch_id`, `tenant_id = round.tenant_id`, and `is_active = True`
- **AND** one `kitchen_ticket_item` row exists per non-voided `round_item`

#### Scenario: Rollback of the round submission also rolls back the ticket

- **WHEN** `RoundService.submit_round` raises an exception after the ticket is added to the session but before commit
- **THEN** the transaction rolls back and no `kitchen_ticket` row exists for that round

#### Scenario: Voided items are excluded from the new ticket

- **WHEN** a round has 3 items, 1 of which is voided, and the round is submitted
- **THEN** the created ticket has exactly 2 `kitchen_ticket_item` rows matching the non-voided items

### Requirement: Ticket state mirrors the round's kitchen-visible slice

The system SHALL keep the ticket's state synchronised with its parent round's state across the kitchen-visible transitions. Specifically:

| Round transition | Ticket change |
|------------------|---------------|
| SUBMITTED → IN_KITCHEN | ticket.started_at := now() (status stays IN_PROGRESS) |
| IN_KITCHEN → READY | ticket.status := READY, ticket.ready_at := now() |
| READY → SERVED | ticket.status := DELIVERED, ticket.delivered_at := now() |
| any → CANCELED (from SUBMITTED, IN_KITCHEN, or READY) | ticket.is_active := False |

All ticket mutations MUST happen in the same DB transaction as the round transition that triggers them.

#### Scenario: Kitchen starts cooking — started_at is set

- **WHEN** the kitchen calls `PATCH /api/kitchen/rounds/{id}` with `status=IN_KITCHEN` (or `PATCH /api/kitchen/tickets/{id}` equivalent if exposed)
- **THEN** the ticket's `started_at` column is populated with the commit timestamp
- **AND** the ticket's `status` remains `IN_PROGRESS`

#### Scenario: Kitchen marks ready — ticket advances

- **WHEN** the kitchen calls `PATCH /api/kitchen/rounds/{id}` with `status=READY`
- **THEN** both the round's status becomes READY and the ticket's status becomes READY
- **AND** the ticket's `ready_at` column is populated

#### Scenario: Waiter serves — ticket delivered

- **WHEN** `PATCH /api/waiter/rounds/{id}/serve` fires
- **THEN** both the round's status becomes SERVED and the ticket's status becomes DELIVERED
- **AND** the ticket's `delivered_at` column is populated

#### Scenario: Round cancellation after SUBMITTED soft-deletes the ticket

- **WHEN** a MANAGER or ADMIN cancels a round currently in state SUBMITTED, IN_KITCHEN, or READY
- **THEN** the ticket's `is_active` becomes False
- **AND** the ticket's status remains unchanged (no CANCELED status exists in the ticket FSM)

#### Scenario: Round cancellation before SUBMITTED is a no-op on tickets

- **WHEN** a MANAGER or ADMIN cancels a round currently in state PENDING or CONFIRMED
- **THEN** no ticket exists for that round, and the cancel operation does not raise an error

### Requirement: Kitchen ticket listing endpoint

The system SHALL provide `GET /api/kitchen/tickets` to list active tickets for a branch. The endpoint REQUIRES JWT authentication with role KITCHEN, MANAGER, or ADMIN, and REQUIRES a `branch_id` query parameter. It optionally accepts a `status` filter (one of `IN_PROGRESS`, `READY`, `DELIVERED`).

The listing SHALL:
- Filter by `tenant_id` from the caller's JWT.
- Filter by the caller's `branch_ids` when the caller is not ADMIN.
- Exclude soft-deleted tickets (`is_active = False`).
- Eagerly load items, parent round, session, table, and sector so the response is one round-trip.
- Never return tickets whose parent round is in a state outside SUBMITTED/IN_KITCHEN/READY/SERVED.

#### Scenario: Kitchen user sees active tickets for their branch

- **WHEN** a KITCHEN user with `branch_ids=[1]` calls `GET /api/kitchen/tickets?branch_id=1`
- **THEN** the response is a 200 listing only tickets where `branch_id=1`, `tenant_id=user.tenant_id`, `is_active=True`

#### Scenario: Kitchen user cannot see another branch's tickets

- **WHEN** a KITCHEN user with `branch_ids=[1]` calls `GET /api/kitchen/tickets?branch_id=2`
- **THEN** the response is 403 Forbidden

#### Scenario: Canceled-round ticket not in listing

- **WHEN** a round in SUBMITTED has a ticket, then the round is canceled, then `GET /api/kitchen/tickets` is called
- **THEN** the response does not contain the cancelled round's ticket

#### Scenario: Status filter narrows results

- **WHEN** `GET /api/kitchen/tickets?branch_id=1&status=READY` is called
- **THEN** only tickets with `status='READY'` appear in the response

#### Scenario: Non-kitchen user rejected

- **WHEN** a WAITER calls `GET /api/kitchen/tickets?branch_id=1`
- **THEN** the response is 403 Forbidden

### Requirement: Kitchen ticket status update endpoint

The system SHALL provide `PATCH /api/kitchen/tickets/{ticket_id}` to transition a ticket's status. The endpoint REQUIRES JWT with role KITCHEN, MANAGER, or ADMIN and accepts a body of `{ status: "READY" | "DELIVERED" }`.

`PATCH` with `status=READY` SHALL drive the underlying round's `IN_KITCHEN → READY` transition. `PATCH` with `status=DELIVERED` SHALL drive the round's `READY → SERVED` transition. The endpoint SHALL delegate to `TicketService.set_status()`, which internally calls the appropriate `RoundService` method so that the round-and-ticket pair remains synchronised.

Invalid target statuses (`IN_PROGRESS` or any unknown value) SHALL result in `400 Bad Request`. Attempts to transition a ticket that is not in the correct precondition state SHALL result in `409 Conflict`.

#### Scenario: Ticket → READY cascades to round

- **WHEN** `PATCH /api/kitchen/tickets/{id}` is called with `status=READY` against a ticket whose round is IN_KITCHEN
- **THEN** both the round and the ticket are READY after commit
- **AND** the ticket's `ready_at` is set

#### Scenario: Ticket → DELIVERED cascades to round

- **WHEN** `PATCH /api/kitchen/tickets/{id}` is called with `status=DELIVERED` against a ticket whose round is READY
- **THEN** both the round's status becomes SERVED and the ticket's status becomes DELIVERED

#### Scenario: Invalid target IN_PROGRESS rejected

- **WHEN** `PATCH /api/kitchen/tickets/{id}` is called with `status=IN_PROGRESS`
- **THEN** the response is 400 Bad Request

#### Scenario: Transition from wrong source state rejected

- **WHEN** `PATCH /api/kitchen/tickets/{id}` is called with `status=DELIVERED` against a ticket whose round is still IN_KITCHEN
- **THEN** the response is 409 Conflict, and neither the round nor the ticket changes

#### Scenario: Tenant isolation enforced

- **WHEN** a KITCHEN user from tenant A tries to PATCH a ticket that belongs to tenant B
- **THEN** the response is 403 Forbidden or 404 Not Found, and no changes occur

### Requirement: Kitchen ticket websocket events

The system SHALL emit the following WebSocket events for ticket lifecycle:

| Event | Delivery | Payload |
|-------|----------|---------|
| `TICKET_CREATED` | Direct Redis | `{ ticket_id, round_id, branch_id, tenant_id }` |
| `TICKET_IN_PROGRESS` | Direct Redis | `{ ticket_id, round_id, branch_id, tenant_id }` |
| `TICKET_READY` | **Outbox** | `{ ticket_id, round_id, branch_id, tenant_id }` |
| `TICKET_DELIVERED` | Direct Redis | `{ ticket_id, round_id, branch_id, tenant_id }` |

Direct-Redis events SHALL be published after `safe_commit(db)` via `shared.infrastructure.events.publish_event`. Outbox events SHALL be written inside the same DB transaction as the business change via `OutboxService.write_event` — the worker publishes them asynchronously.

#### Scenario: Submitting a round emits TICKET_CREATED

- **WHEN** a round is successfully submitted
- **THEN** after commit, `publish_event` is called with `event_type='TICKET_CREATED'` and a payload containing the new `ticket_id`

#### Scenario: Marking READY writes an outbox row

- **WHEN** a ticket is marked READY
- **THEN** a row exists in `outbox_event` with `event_type='TICKET_READY'` and matching payload
- **AND** the transaction containing the row also updated the ticket

#### Scenario: Failed publish of TICKET_CREATED does not roll back the round

- **WHEN** `publish_event` raises during `TICKET_CREATED` emission
- **THEN** the round and ticket remain SUBMITTED and IN_PROGRESS (the business data is persisted)
- **AND** the error is logged but not re-raised
