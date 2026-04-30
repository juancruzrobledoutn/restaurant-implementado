## ADDED Requirements

### Requirement: Admin checks listing endpoint

The backend SHALL expose `GET /api/admin/checks` to list `app_check` records with pagination and filtering. The endpoint SHALL be a thin FastAPI router (no business logic) that delegates to an `AdminBillingService.list_checks()` domain service. Access SHALL require ADMIN or MANAGER via `PermissionContext.require_management()`.

Query parameters:
- `branch_id` (required, int): SHALL belong to `user.branch_ids` — otherwise 403.
- `from` (optional, ISO date): inclusive lower bound on `created_at`. Default `today`.
- `to` (optional, ISO date): inclusive upper bound on `created_at`. Default `today`.
- `status` (optional, string): one of `REQUESTED`, `PAID`. Omit → both.
- `page` (optional, int, default 1, min 1).
- `page_size` (optional, int, default 20, min 1, max 100).

The service SHALL query `app_check` filtered by `tenant_id = user.tenant_id AND branch_id = :branch_id AND created_at BETWEEN :from AND :to`, optionally `AND status = :status`, ordered by `created_at DESC`, with `LIMIT page_size OFFSET (page - 1) * page_size`. The service SHALL enforce `(to - from) <= 90 days` and raise `ValidationError` (409) otherwise.

The response SHALL be a Pydantic model `PaginatedChecksOut { items: list[CheckSummaryOut], total: int, page: int, page_size: int, total_pages: int }`. `CheckSummaryOut` SHALL include `id`, `session_id`, `branch_id`, `total_cents`, `covered_cents` (computed by summing allocations across all charges), `status`, `created_at`. **It SHALL NOT include nested `charges` or `payments`** — those are lazy-loaded via the existing `GET /api/billing/check/{session_id}` endpoint when the detail modal opens.

Rate limit: `60/minute` per user (auditoría humana, no polling).

#### Scenario: ADMIN lists checks for today
- **WHEN** an ADMIN calls `GET /api/admin/checks?branch_id=42` without `from`/`to`
- **THEN** the endpoint SHALL default both to today's ISO date and return 200 with `PaginatedChecksOut` including `total`, `page=1`, `page_size=20`, `total_pages`

#### Scenario: MANAGER cannot list checks of another branch
- **WHEN** a MANAGER whose `branch_ids = [42]` calls `GET /api/admin/checks?branch_id=99`
- **THEN** the endpoint SHALL return 403 Forbidden with body `{ "detail": "User does not have access to this branch" }`

#### Scenario: WAITER is forbidden
- **WHEN** a WAITER calls `GET /api/admin/checks?branch_id=42`
- **THEN** the endpoint SHALL return 403 Forbidden

#### Scenario: Filter by status returns only matching records
- **WHEN** an ADMIN calls `GET /api/admin/checks?branch_id=42&status=PAID`
- **THEN** the response SHALL include only checks with `status="PAID"`, ordered by `created_at DESC`

#### Scenario: Page size clamped to 100
- **WHEN** an ADMIN calls `GET /api/admin/checks?branch_id=42&page_size=500`
- **THEN** the endpoint SHALL return 422 with a Pydantic validation error on `page_size`

#### Scenario: Date range exceeding 90 days returns 409
- **WHEN** an ADMIN calls `GET /api/admin/checks?branch_id=42&from=2026-01-01&to=2026-12-31`
- **THEN** the service SHALL raise `ValidationError` and the router SHALL return 409 with a Spanish error message describing the 90-day limit

#### Scenario: covered_cents is computed correctly
- **WHEN** a check with `total_cents=10000` has two charges with allocations summing `7500`
- **THEN** the response row SHALL include `covered_cents: 7500` and `total_cents: 10000`

#### Scenario: Cross-tenant isolation
- **WHEN** ADMIN A of tenant 1 calls `GET /api/admin/checks?branch_id=42` and tenant 2 also has a branch with id 42
- **THEN** the response SHALL only include checks where `tenant_id=1 AND branch_id=42` — checks of tenant 2 SHALL NOT appear under any circumstance

#### Scenario: Rate limit enforcement
- **WHEN** an authenticated user sends 61 requests to `GET /api/admin/checks` within one minute
- **THEN** the 61st request SHALL return 429 Too Many Requests

---

### Requirement: Admin payments listing endpoint

The backend SHALL expose `GET /api/admin/payments` to list `payment` records with pagination and filtering. The endpoint SHALL be a thin FastAPI router that delegates to `AdminBillingService.list_payments()`. Access SHALL require ADMIN or MANAGER via `PermissionContext.require_management()`.

Query parameters:
- `branch_id` (required, int): SHALL belong to `user.branch_ids` — otherwise 403.
- `from` (optional, ISO date): inclusive lower bound on `created_at`. Default `today`.
- `to` (optional, ISO date): inclusive upper bound on `created_at`. Default `today`.
- `method` (optional, string): one of `cash`, `card`, `transfer`, `mercadopago`. Omit → all methods.
- `status` (optional, string): one of `APPROVED`, `REJECTED`, `PENDING`, `FAILED`. Omit → all statuses.
- `page`, `page_size`: same rules as the checks endpoint.

The service SHALL join `payment` with `app_check` to filter by `branch_id` (since `payment` references check, and check has `branch_id`). Query: `WHERE check.tenant_id = :tenant AND check.branch_id = :branch AND payment.created_at BETWEEN :from AND :to`, plus optional `method` / `status`, ordered by `payment.created_at DESC`.

The response SHALL be `PaginatedPaymentsOut { items: list[PaymentSummaryOut], total, page, page_size, total_pages }`. `PaymentSummaryOut` SHALL include `id`, `check_id`, `amount_cents`, `method`, `status`, `external_id`, `created_at`. The `external_id` SHALL be `null` for manual payments (cash/card/transfer) and populated for `mercadopago` payments.

Rate limit: `60/minute` per user.

#### Scenario: Filter by method "cash" returns only cash payments
- **WHEN** an ADMIN calls `GET /api/admin/payments?branch_id=42&method=cash`
- **THEN** all returned payments SHALL have `method="cash"`

#### Scenario: Filter by status "REJECTED" includes FAILED? No.
- **WHEN** an ADMIN calls `GET /api/admin/payments?branch_id=42&status=REJECTED`
- **THEN** only payments with `status="REJECTED"` SHALL appear — `FAILED` payments SHALL NOT appear unless the caller explicitly requests `status=FAILED`

#### Scenario: Results ordered by created_at DESC
- **WHEN** three payments are created at `10:00`, `10:05`, `10:10`
- **THEN** the listing SHALL return them in order `[10:10, 10:05, 10:00]`

#### Scenario: Cross-branch filtering via join
- **WHEN** branch 42 has check 10 with payment 100, and branch 99 has check 20 with payment 200, and user requests `branch_id=42`
- **THEN** the response SHALL only include payment 100 — payment 200 SHALL NOT appear

#### Scenario: external_id is null for manual payments
- **WHEN** a manual cash payment registered via `POST /api/waiter/payments/manual` is returned by the listing
- **THEN** the response row SHALL have `external_id=null` and `method="cash"`

#### Scenario: external_id is present for MercadoPago payments
- **WHEN** a MercadoPago payment confirmed via webhook is returned by the listing
- **THEN** the response row SHALL have `external_id` populated with the MP payment ID and `method="mercadopago"`

#### Scenario: KITCHEN is forbidden
- **WHEN** a KITCHEN user calls `GET /api/admin/payments?branch_id=42`
- **THEN** the endpoint SHALL return 403 Forbidden

#### Scenario: WAITER is forbidden
- **WHEN** a WAITER calls `GET /api/admin/payments?branch_id=42`
- **THEN** the endpoint SHALL return 403 Forbidden

---

### Requirement: AdminBillingService encapsulates listing queries

The backend SHALL implement `AdminBillingService` in `backend/rest_api/services/domain/admin_billing_service.py` with public methods `list_checks(...)` and `list_payments(...)`. The service SHALL follow Clean Architecture — no HTTP concerns (no `HTTPException`, no `Request`), only domain logic raising `ValidationError` / `NotFoundError` on invalid inputs.

The service SHALL NOT duplicate logic from `BillingService`. The FIFO algorithm, check request, payment registration remain in `BillingService`. `AdminBillingService` is read-only and SHALL NOT expose mutation methods.

#### Scenario: Service rejects date range over 90 days
- **WHEN** `AdminBillingService.list_checks(from=2026-01-01, to=2026-12-31, ...)` is called
- **THEN** the service SHALL raise `ValidationError` with the Spanish message "El rango de fechas no puede superar 90 días"

#### Scenario: Service computes covered_cents without N+1
- **WHEN** `AdminBillingService.list_checks(branch_id=42, ...)` is called and 20 checks are returned
- **THEN** a single SQL query SHALL compute `covered_cents` via a subquery or window function joining `charge` and `allocation`, not 20 separate queries per check

#### Scenario: Service filters by tenant_id always
- **WHEN** any method of `AdminBillingService` is called
- **THEN** every query SHALL include `WHERE tenant_id = :tenant_id` — omitting this filter SHALL be impossible because the method signature requires `tenant_id` as a mandatory parameter

---

### Requirement: Admin billing endpoints are documented in OpenAPI

Both `GET /api/admin/checks` and `GET /api/admin/payments` SHALL appear in the auto-generated OpenAPI schema at `/docs` with tag `admin-billing`, descriptive summaries in English (consistent with rest of codebase), request parameters, and response models.

#### Scenario: Endpoint appears in Swagger UI
- **WHEN** a developer opens `http://localhost:8000/docs` after the endpoints are deployed
- **THEN** the `admin-billing` section SHALL list both endpoints with expandable parameter documentation and example responses
