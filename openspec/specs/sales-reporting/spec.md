# sales-reporting Specification

## Purpose
TBD - created by archiving change dashboard-operations. Update Purpose after archive.
## Requirements
### Requirement: Daily Sales KPI Endpoint

The backend SHALL expose `GET /api/admin/sales/daily?branch_id={int}&date={YYYY-MM-DD}` that returns daily KPIs for the given branch and date. The endpoint MUST require JWT authentication and `PermissionContext.require_management()` (ADMIN or MANAGER with access to the branch). The response SHALL include: `revenue_cents` (sum of `amount_cents` from paid `Payment` records whose `Check.status == "PAID"`), `orders` (count of distinct paid `Check`), `average_ticket_cents` (integer division: `revenue_cents / orders`, or 0 when orders is 0), and `diners` (sum of distinct `Diner` rows across the paid checks' sessions).

All queries MUST filter by `tenant_id` via join with `Branch.tenant_id == ctx.tenant_id` and MUST use `.is_(True)` for active flags. The date filter MUST use `created_at` of the `Check` record, bounded by the calendar day in the server's timezone (UTC).

#### Scenario: ADMIN fetches sales for today
- **WHEN** an ADMIN sends `GET /api/admin/sales/daily?branch_id=1&date=2026-04-19`
- **THEN** the response SHALL be 200 with `{ revenue_cents, orders, average_ticket_cents, diners }` all as non-negative integers

#### Scenario: No sales on the requested date
- **WHEN** the branch has zero paid checks on the date
- **THEN** the response SHALL be 200 with `{ revenue_cents: 0, orders: 0, average_ticket_cents: 0, diners: 0 }`

#### Scenario: MANAGER without branch access
- **WHEN** a MANAGER without access to `branch_id=1` sends the request
- **THEN** the response SHALL be 403 with `{ detail: "No tiene acceso a esta sucursal" }` (or the existing ForbiddenError shape)

#### Scenario: WAITER forbidden
- **WHEN** a WAITER sends `GET /api/admin/sales/daily`
- **THEN** the response SHALL be 403

#### Scenario: Cross-tenant query returns 403
- **WHEN** a user from tenant A queries `branch_id` belonging to tenant B
- **THEN** the response SHALL be 403 (ForbiddenError from `PermissionContext.require_branch_access`)

#### Scenario: Invalid date format returns 422
- **WHEN** the user sends `date=not-a-date`
- **THEN** FastAPI/Pydantic validation SHALL return 422

---

### Requirement: Top Products Endpoint

The backend SHALL expose `GET /api/admin/sales/top-products?branch_id={int}&date={YYYY-MM-DD}&limit={int, default=10, max=50}` that returns the products with the most revenue for the branch on the given date. The endpoint MUST require `PermissionContext.require_management()`.

The response SHALL be a list of `{ product_id, product_name, quantity_sold, revenue_cents }` sorted by `revenue_cents` descending, limited to `limit`. The aggregation SHALL be over `RoundItem` rows joined to the paid `Check` via `Round → TableSession → Check (status=PAID)`, excluding voided items (`is_voided=False`).

#### Scenario: ADMIN requests top products for today
- **WHEN** an ADMIN sends `GET /api/admin/sales/top-products?branch_id=1&date=2026-04-19`
- **THEN** the response SHALL be 200 with a list of up to 10 entries sorted by revenue descending

#### Scenario: Empty list when no sales
- **WHEN** the branch has no paid checks on the date
- **THEN** the response SHALL be 200 with an empty list

#### Scenario: Voided items are excluded
- **WHEN** the branch has a round with one voided item and one non-voided item of different products
- **THEN** only the non-voided product SHALL appear in the response

#### Scenario: limit parameter capped at 50
- **WHEN** the client sends `limit=100`
- **THEN** the endpoint SHALL return 422 validation error (Pydantic Ge/Le) or clamp to 50 depending on the validator

#### Scenario: Cross-tenant query returns 403
- **WHEN** a user from tenant A queries a branch of tenant B
- **THEN** the response SHALL be 403

---

### Requirement: SalesService Domain Service

The backend SHALL implement `SalesService` in `backend/rest_api/services/domain/sales_service.py` following Clean Architecture. The service SHALL NOT extend `BranchScopedService` because it is a read-only aggregation helper, not a CRUD service. It SHALL expose two methods:

- `get_daily_kpis(branch_id: int, date: date, tenant_id: int) -> DailyKPIsOutput`
- `get_top_products(branch_id: int, date: date, tenant_id: int, limit: int = 10) -> list[TopProductOutput]`

Both methods SHALL filter by `tenant_id` via join with `Branch`. Both methods SHALL filter by `Check.status == "PAID"` and `Check.is_active.is_(True)`. The router SHALL be thin and delegate all business logic to this service.

#### Scenario: Service filters by tenant_id
- **WHEN** `get_daily_kpis` is called with `tenant_id=1` but a check belongs to tenant 2
- **THEN** the aggregated data SHALL NOT include that check

#### Scenario: Service excludes unpaid checks
- **WHEN** a check has status "REQUESTED" (not yet paid)
- **THEN** its revenue SHALL NOT be counted in `revenue_cents`

#### Scenario: Service uses .is_(True) for booleans
- **WHEN** the implementation is reviewed
- **THEN** all boolean filters SHALL use `.is_(True)` / `.is_(False)`, never `== True` / `== False`

