## ADDED Requirements

### Requirement: Check model (app_check)
The system SHALL store checks with fields: `id` (BigInteger PK), `session_id` (FK to `table_session`, ondelete RESTRICT), `branch_id` (BigInteger FK, denormalised), `tenant_id` (BigInteger FK, denormalised), `total_cents` (Integer, not null), `status` (String 20, one of `REQUESTED`, `PAID`, default `REQUESTED`), plus `AuditMixin` fields. Table name: `app_check` (SQL reserved word). Unique constraint on `session_id` (one check per session). Index on `branch_id`.

#### Scenario: Check is created with REQUESTED status
- **WHEN** `BillingService.request_check(session_id=42, ...)` is called
- **THEN** an `app_check` row SHALL be persisted with `status='REQUESTED'` and `total_cents` equal to the sum of all charges

#### Scenario: A session can only have one check
- **WHEN** a second `app_check` insert is attempted for `session_id=42`
- **THEN** the database SHALL reject it via the unique constraint on `session_id`

---

### Requirement: Charge model
The system SHALL store charges with fields: `id` (BigInteger PK), `check_id` (FK to `app_check`, ondelete RESTRICT), `diner_id` (FK to `diner`, ondelete RESTRICT, nullable — shared charges have no diner), `amount_cents` (Integer, not null, CHECK `amount_cents > 0`), `description` (String 255, nullable), `created_at` (DateTime, server default now()), `is_active` (Boolean, default True). Table name: `charge`. Index on `check_id`.

#### Scenario: Charge is created per diner or as shared
- **WHEN** `BillingService.request_check()` generates charges using the `equal_split` method for 3 diners with total 9000 cents
- **THEN** 3 `charge` rows SHALL be created, each with `amount_cents=3000`

#### Scenario: Charge amount must be positive
- **WHEN** a charge insert is attempted with `amount_cents=0` or negative
- **THEN** the database SHALL reject it via the CHECK constraint

---

### Requirement: Payment model
The system SHALL store payments with fields: `id` (BigInteger PK), `check_id` (FK to `app_check`, ondelete RESTRICT), `amount_cents` (Integer, not null, CHECK `amount_cents > 0`), `method` (String 50: `cash`, `card`, `transfer`, `mercadopago`), `status` (String 20: `PENDING`, `APPROVED`, `REJECTED`, `FAILED`, default `PENDING`), `external_id` (String 255, nullable, unique — idempotency key for MP IPN), `created_at` (DateTime, server default now()), `is_active` (Boolean, default True). Table name: `payment`. Index on `check_id`. Partial unique index on `(external_id) WHERE external_id IS NOT NULL`.

#### Scenario: Manual payment is created with APPROVED status directly
- **WHEN** `BillingService.register_manual_payment(check_id, amount_cents, method='cash', ...)` is called
- **THEN** a `payment` row SHALL be created with `status='APPROVED'` and FIFO allocation SHALL run immediately

#### Scenario: MercadoPago payment starts as PENDING
- **WHEN** `BillingService.create_mp_preference(check_id, ...)` is called
- **THEN** a `payment` row SHALL be created with `status='PENDING'` and `method='mercadopago'`

#### Scenario: Duplicate external_id is rejected
- **WHEN** a second payment insert is attempted with the same `external_id`
- **THEN** the database SHALL reject it via the partial unique index

---

### Requirement: Allocation model (FIFO)
The system SHALL store allocations with fields: `id` (BigInteger PK), `charge_id` (FK to `charge`, ondelete RESTRICT), `payment_id` (FK to `payment`, ondelete RESTRICT), `amount_cents` (Integer, not null, CHECK `amount_cents > 0`). Table name: `allocation`. Index on `(charge_id, payment_id)`.

#### Scenario: FIFO allocates oldest charges first
- **WHEN** a check has 3 charges of 3000 cents each (created at t1 < t2 < t3) AND a payment of 5000 cents arrives
- **THEN** charge at t1 SHALL be fully covered (3000 cents allocation) AND charge at t2 SHALL be partially covered (2000 cents allocation) AND charge at t3 SHALL have zero allocation

#### Scenario: Multiple payments can cover one charge
- **WHEN** a charge of 6000 cents receives two payments of 3000 cents each
- **THEN** two allocations of 3000 cents each SHALL reference the same charge_id

#### Scenario: One payment can span multiple charges
- **WHEN** a payment of 9000 cents is allocated against 3 charges of 3000 cents each
- **THEN** 3 allocations of 3000 cents each SHALL reference the same payment_id

#### Scenario: Allocation amount must be positive
- **WHEN** an allocation insert is attempted with `amount_cents=0`
- **THEN** the database SHALL reject it via the CHECK constraint

---

### Requirement: BillingService.request_check atomicity
`BillingService.request_check(session_id, split_method, db)` SHALL atomically: (1) verify session is OPEN, (2) set `session.status = 'PAYING'`, (3) calculate charges per split method, (4) create `app_check` + `charge` rows, (5) write `CHECK_REQUESTED` Outbox event. All steps SHALL commit in a single `safe_commit(db)`. If any step fails, no state SHALL change.

#### Scenario: request_check on OPEN session creates check and transitions session
- **WHEN** `request_check(session_id=42, split_method='equal_split')` is called on an OPEN session
- **THEN** `session.status` SHALL become `'PAYING'` AND an `app_check` SHALL exist with `status='REQUESTED'` AND an Outbox event `CHECK_REQUESTED` SHALL be pending

#### Scenario: request_check on PAYING session returns 409
- **WHEN** `request_check` is called on a session with `status='PAYING'`
- **THEN** the service SHALL raise a ConflictError (HTTP 409) — duplicate check request not allowed

#### Scenario: request_check on CLOSED session returns 409
- **WHEN** `request_check` is called on a session with `status='CLOSED'`
- **THEN** the service SHALL raise a ConflictError (HTTP 409)

---

### Requirement: BillingService.register_manual_payment
`BillingService.register_manual_payment(check_id, amount_cents, method, db, reference=None)` SHALL: (1) verify check exists and is REQUESTED, (2) create a `payment` with `status='APPROVED'`, (3) run FIFO allocation (via `_allocate(payment, db)`), (4) if all charges now fully covered, set `check.status='PAID'`, transition `session.status='CLOSED'` and write `CHECK_PAID` Outbox event. All steps in a single `safe_commit(db)`.

#### Scenario: Full manual payment closes the check
- **WHEN** a check has total 9000 cents AND `register_manual_payment(amount_cents=9000, method='cash')` is called
- **THEN** all charges SHALL be fully allocated AND `check.status` SHALL become `'PAID'` AND `session.status` SHALL become `'CLOSED'` AND Outbox events `PAYMENT_APPROVED` and `CHECK_PAID` SHALL be pending

#### Scenario: Partial manual payment leaves check REQUESTED
- **WHEN** a check has total 9000 cents AND `register_manual_payment(amount_cents=5000, method='card')` is called
- **THEN** `check.status` SHALL remain `'REQUESTED'` AND only 5000 cents of charges SHALL be allocated

#### Scenario: register_manual_payment on PAID check returns 409
- **WHEN** `register_manual_payment` is called on a check with `status='PAID'`
- **THEN** the service SHALL raise a ConflictError (HTTP 409)

---

### Requirement: BillingService.process_mp_webhook
`BillingService.process_mp_webhook(external_id, mp_status, db)` SHALL: (1) verify `HMAC-SHA256` signature from `MERCADOPAGO_WEBHOOK_SECRET`, (2) use `external_id` as idempotency key — if a payment with this `external_id` already exists in a terminal state (`APPROVED`/`REJECTED`/`FAILED`), return immediately (no duplicate processing), (3) for `approved`: set `payment.status='APPROVED'`, run FIFO allocation, resolve check if full, (4) for `rejected`/`failed`: set `payment.status` accordingly and write `PAYMENT_REJECTED` Outbox event.

#### Scenario: Approved IPN updates payment and runs FIFO
- **WHEN** IPN arrives with `external_id='mp-123'` and `mp_status='approved'`
- **THEN** the matching `payment` SHALL have `status='APPROVED'` AND FIFO allocation SHALL run

#### Scenario: Duplicate IPN is idempotent
- **WHEN** the same `external_id='mp-123'` IPN arrives twice
- **THEN** the second call SHALL return 200 without creating duplicate allocations

#### Scenario: Rejected IPN writes PAYMENT_REJECTED Outbox event
- **WHEN** IPN arrives with `mp_status='rejected'`
- **THEN** `payment.status` SHALL become `'REJECTED'` AND an Outbox event `PAYMENT_REJECTED` SHALL be pending

---

### Requirement: Billing endpoints — check request and status
The system SHALL provide:
- `POST /api/billing/check/request` (JWT or Table Token, 5/min): calls `BillingService.request_check()`, returns 201 with the created check.
- `GET /api/billing/check/{session_id}` (JWT or Table Token, 20/min): returns the check with charges, payments, and remaining balance.

#### Scenario: Diner requests check via billing endpoint
- **WHEN** a diner with a valid Table Token sends `POST /api/billing/check/request` with `{"split_method": "equal_split"}`
- **THEN** the system SHALL return 201 with the check payload AND `session.status` SHALL be `'PAYING'`

#### Scenario: Staff reads check status
- **WHEN** a WAITER sends `GET /api/billing/check/42`
- **THEN** the system SHALL return 200 with the check, its charges, and all payments with their allocation details

#### Scenario: Rate limit on check request
- **WHEN** the same IP sends more than 5 `POST /api/billing/check/request` requests per minute
- **THEN** the system SHALL return 429

---

### Requirement: Billing endpoints — MercadoPago
The system SHALL provide:
- `POST /api/billing/payment/preference` (JWT or Table Token, 5/min): calls `MercadoPagoGateway.create_preference()`, returns the MP preference ID and `init_point` URL.
- `POST /api/billing/payment/webhook` (no auth, signature verification): calls `BillingService.process_mp_webhook()`.
- `GET /api/billing/payment/{id}/status` (JWT or Table Token, 20/min): returns payment status.

#### Scenario: Create MP preference returns init_point
- **WHEN** `POST /api/billing/payment/preference` is called with `{"check_id": 10}`
- **THEN** the system SHALL return 200 with `{"preference_id": "...", "init_point": "https://..."}`

#### Scenario: Webhook without valid signature returns 400
- **WHEN** `POST /api/billing/payment/webhook` is called without the `x-signature` header or with an invalid signature
- **THEN** the system SHALL return 400 (fail-closed)

---

### Requirement: Waiter manual payment endpoint
The system SHALL provide `POST /api/waiter/payments/manual` (JWT, WAITER/MANAGER/ADMIN, 20/min). Body: `{"session_id": int, "amount_cents": int, "method": "cash"|"card"|"transfer", "reference": str|null}`. Calls `BillingService.register_manual_payment()`.

#### Scenario: Waiter registers cash payment
- **WHEN** a WAITER sends `POST /api/waiter/payments/manual` with `{"session_id": 42, "amount_cents": 9000, "method": "cash"}`
- **THEN** the system SHALL return 200 with the payment and updated check status

#### Scenario: KITCHEN role cannot register manual payments
- **WHEN** a KITCHEN user sends `POST /api/waiter/payments/manual`
- **THEN** the system SHALL return 403

---

### Requirement: Split methods for charge generation
`BillingService.request_check()` SHALL support three split methods: `equal_split` (total / n, last absorbs rounding), `by_consumption` (charges grouped by diner based on round items), `custom` (caller provides `{"diner_id": amount_cents}` dict, sum must equal total). The split method is passed as query param or body field on the check request endpoint.

#### Scenario: equal_split with rounding residual
- **WHEN** total is 1001 cents and 3 diners
- **THEN** first 2 diners get 333 cents charge each AND the last diner gets 335 cents (absorbs residual 2 cents)

#### Scenario: custom split with incorrect total returns 400
- **WHEN** custom split amounts sum to 8000 cents but check total is 9000 cents
- **THEN** the service SHALL raise a ValidationError (HTTP 400)

---

### Requirement: Outbox events for billing
The system SHALL emit four Outbox events for billing operations, each written atomically in the same transaction as the triggering business operation:

| Event | Trigger | Payload fields |
|-------|---------|---------------|
| `CHECK_REQUESTED` | check created | `check_id`, `session_id`, `branch_id`, `tenant_id`, `total_cents` |
| `CHECK_PAID` | all charges covered | `check_id`, `session_id`, `branch_id`, `tenant_id`, `total_cents` |
| `PAYMENT_APPROVED` | payment approved | `payment_id`, `check_id`, `session_id`, `branch_id`, `tenant_id`, `amount_cents`, `method` |
| `PAYMENT_REJECTED` | payment rejected | `payment_id`, `check_id`, `session_id`, `branch_id`, `tenant_id`, `amount_cents` |

#### Scenario: CHECK_REQUESTED is in outbox after request_check
- **WHEN** `BillingService.request_check()` succeeds
- **THEN** an `outbox_event` row with `event_type='CHECK_REQUESTED'` SHALL exist in the same DB with `processed=False`

#### Scenario: CHECK_PAID and PAYMENT_APPROVED both emitted on full settlement
- **WHEN** a manual payment fully covers all charges
- **THEN** two Outbox events SHALL be pending: `PAYMENT_APPROVED` and `CHECK_PAID`

---

### Requirement: PaymentGateway ABC and MercadoPagoGateway
The system SHALL define `PaymentGateway` as an abstract base class in `backend/rest_api/services/payment_gateway.py` with abstract methods `create_preference(check, items) -> PreferenceOut` and `verify_webhook(payload, signature) -> WebhookEvent`. `MercadoPagoGateway` SHALL implement the ABC using the `mercadopago` SDK. The gateway SHALL be injected via FastAPI `Depends(get_payment_gateway)` — never instantiated inline in a router.

#### Scenario: MercadoPagoGateway is injected, not instantiated in router
- **WHEN** the billing router is inspected
- **THEN** it SHALL NOT contain any direct instantiation of `MercadoPagoGateway` or `mercadopago.SDK`

#### Scenario: Invalid MERCADOPAGO_ACCESS_TOKEN raises at startup
- **WHEN** `MERCADOPAGO_ACCESS_TOKEN` is unset or empty at application startup
- **THEN** the gateway factory SHALL raise a `ConfigurationError` and prevent the app from starting

---

### Requirement: Alembic migration 009 for billing tables
The system SHALL include Alembic migration `009_billing` that creates tables `app_check`, `charge`, `payment`, `allocation`. `down_revision` SHALL be `"008_kitchen"`. All tables include FKs with `ondelete=RESTRICT`. `downgrade()` SHALL drop tables in reverse dependency order: `allocation` → `payment` → `charge` → `app_check`.

#### Scenario: Migration 009 applies cleanly on top of 008
- **WHEN** `alembic upgrade head` is run on a DB at revision `008_kitchen`
- **THEN** tables `app_check`, `charge`, `payment`, `allocation` SHALL exist with all columns, FKs, indexes, and constraints specified

#### Scenario: Downgrade reverses cleanly
- **WHEN** `alembic downgrade 008_kitchen` is run
- **THEN** tables `allocation`, `payment`, `charge`, `app_check` SHALL be dropped in that order without FK violations

---

### Requirement: Rate limiting for billing endpoints
The system SHALL apply Redis-backed rate limiting to all billing endpoints:
- `POST /api/billing/check/request`: 5 requests/minute per IP
- `POST /api/billing/payment/preference`: 5 requests/minute per IP
- `GET /api/billing/check/{session_id}`, `GET /api/billing/payment/{id}/status`: 20 requests/minute per IP
- `POST /api/waiter/payments/manual`: 20 requests/minute per IP

Limits SHALL use the same Redis+Lua atomic mechanism as auth rate limiting. Exceeded limits SHALL return 429.

#### Scenario: Exceeding check request limit returns 429
- **WHEN** the same IP sends 6 `POST /api/billing/check/request` within 60 seconds
- **THEN** the 6th request SHALL return 429

#### Scenario: Rate limit keys are per-endpoint and per-IP
- **WHEN** an IP hits the check request limit (5/min)
- **THEN** it SHALL still be able to call `GET /api/billing/check/{id}` within its own 20/min limit

---

### Requirement: Multi-tenant isolation for billing
Every billing query SHALL filter by `tenant_id` derived from the session's branch. A WAITER from tenant A MUST NOT be able to create payments for checks belonging to tenant B.

#### Scenario: Tenant A cannot access tenant B check
- **WHEN** a user from tenant A sends `GET /api/billing/check/99` where check 99 belongs to tenant B
- **THEN** the system SHALL return 403 or 404 (never 200 with data)
