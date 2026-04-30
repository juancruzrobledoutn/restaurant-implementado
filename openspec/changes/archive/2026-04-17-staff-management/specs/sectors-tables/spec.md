## ADDED Requirements

### Requirement: Waiter daily assignment verification (pre-login)
The system SHALL provide a WAITER-scoped endpoint `GET /api/waiter/verify-branch-assignment?branch_id={id}` that consumes the existing `WaiterSectorAssignment` model (defined in this capability) to check whether the authenticated waiter has an active assignment for the current date in any sector of the specified branch. This endpoint is consumed by pwaWaiter's pre-login flow (after login, before granting access to the main UI).

The endpoint MUST always return HTTP 200 (never 403/404 on negative cases) with a stable JSON structure to prevent enumeration of branches/sectors.

#### Scenario: Authenticated WAITER with valid today-assignment
- **WHEN** a WAITER's JWT is valid and they have `WaiterSectorAssignment(user_id=me, sector_id=X, date=today())` where sector X belongs to branch 1
- **AND** they call `GET /api/waiter/verify-branch-assignment?branch_id=1`
- **THEN** the system SHALL return 200 with `{assigned: true, sector_id: X, sector_name: "..."}`

#### Scenario: Authenticated WAITER without today-assignment
- **WHEN** a WAITER has NO assignment for today in branch 1
- **AND** they call `GET /api/waiter/verify-branch-assignment?branch_id=1`
- **THEN** the system SHALL return 200 with `{assigned: false}` (no sector fields)

#### Scenario: Non-WAITER role
- **WHEN** an ADMIN/MANAGER/KITCHEN user calls the endpoint
- **THEN** the system SHALL return 403 Forbidden (the endpoint is exclusively for WAITER role)

#### Scenario: Branch does not exist in tenant
- **WHEN** a WAITER calls `GET /api/waiter/verify-branch-assignment?branch_id=99999` where 99999 is not a branch of their tenant
- **THEN** the system SHALL return 200 with `{assigned: false}` (does NOT disclose branch existence)

#### Scenario: Multiple assignments in the same branch same day
- **WHEN** a WAITER has assignments in TWO sectors of branch 1 on today's date
- **AND** they call `GET /api/waiter/verify-branch-assignment?branch_id=1`
- **THEN** the system SHALL return 200 with `{assigned: true, ...}` where `sector_id` is the first match (deterministic ordering by `sector_id ASC`)

#### Scenario: Date is resolved in UTC
- **WHEN** the server resolves "today" for the verification query
- **THEN** the system SHALL use `date.today()` in UTC (tenant-local timezone is deferred to a future change)
