## Context

The system has core models (Tenant, Branch, User, UserBranchRole) from C-02, a complete auth stack (JWT, 2FA, rate limiting, RBAC) from C-03, and a menu catalog (Category, Subcategory, Product, BranchProduct) from C-04. The next layer in the critical path is the physical layout of branches: sectors and tables.

Sectors divide a branch into zones (e.g., "Terraza", "Salón principal", "Barra"). Tables belong to a sector and have alphanumeric codes (e.g., "INT-01"). Waiters are assigned to sectors on a daily basis via `WaiterSectorAssignment` — this is the mechanism that controls which tables a waiter can serve and which WebSocket events they receive.

Constraints:
- Clean Architecture: routers are thin HTTP handlers, all logic in domain services
- Multi-tenant: every query MUST filter by tenant_id (via branch -> tenant chain)
- Soft delete only (is_active = False)
- `BranchScopedService` exists from C-02 as the base class for branch-scoped services
- `PermissionContext` exists from C-03 for authorization
- `app_table` as table name because `table` is a SQL reserved word
- Table codes are NOT unique across branches — always filter by branch

## Goals / Non-Goals

**Goals:**
- Implement 3 models: BranchSector, Table (app_table), WaiterSectorAssignment
- Provide admin CRUD endpoints for sectors and tables with RBAC enforcement
- Provide waiter-to-sector assignment management (create, list, delete by date)
- Deliver a public branches endpoint for pwaWaiter pre-login flow
- Validate table code uniqueness within a branch (not globally)
- Support daily waiter assignment verification (check if assigned TODAY)

**Non-Goals:**
- Table sessions (OPEN/PAYING/CLOSED lifecycle) — deferred to C-08
- Table Token HMAC authentication — deferred to C-08
- WebSocket event routing by sector — deferred to C-09
- Visual table status in pwaWaiter frontend — deferred to C-20
- Table QR code generation — not in C-07 scope
- Waiter schedule management beyond daily assignment — out of MVP scope

## Decisions

### D-01: Table model uses `app_table` as table name

**Decision**: The SQLAlchemy model class is named `Table` but uses `__tablename__ = "app_table"` to avoid the SQL reserved word conflict.

**Alternatives considered**:
- Using `RestaurantTable` or `DiningTable` as model name: More descriptive but inconsistent with the domain language. The knowledge base and all documentation refer to it as "Table". The `app_` prefix convention is already established for `app_tenant` and `app_check`.

**Rationale**: Consistent with the project's convention for SQL reserved words (prefix `app_`). The model class name stays `Table` for code readability; only the database table name changes.

### D-02: Table code uniqueness is scoped to branch, not global

**Decision**: `UniqueConstraint("branch_id", "code")` on `app_table`. Two branches can have tables with the same code (e.g., both have "INT-01").

**Alternatives considered**:
- Global uniqueness: Simpler constraint but prevents independent branch management. A chain with 10 branches would need globally unique codes, which is impractical.

**Rationale**: The knowledge base explicitly states codes are NOT unique across branches. The `branch_slug` is always required to disambiguate. This matches real-world usage — each branch manages its own table numbering independently.

### D-03: WaiterSectorAssignment is a flat record per date, not a range

**Decision**: Each assignment has a `date` field (Date type, not DateTime). To check if a waiter is assigned today, query `WHERE user_id = X AND sector_id IN (branch_sectors) AND date = today()`. No `is_active` on assignments — they're ephemeral daily records.

**Alternatives considered**:
- Date range (start_date, end_date): Adds complexity for scheduling but the business requirement is daily assignments. A waiter can be in different sectors on different days.
- Soft-delete on assignments: Unnecessary — assignments are for a specific date and become irrelevant after that date. Hard delete is acceptable here.

**Rationale**: Daily assignments are the simplest model that satisfies the business requirement. The knowledge base states "Las asignaciones son diarias." A waiter must be assigned for TODAY's date to operate. Past assignments are historical data but don't need soft-delete semantics.

### D-04: Sector and Table services extend BranchScopedService

**Decision**: `SectorService` and `TableService` extend `BranchScopedService[Model, Output]`. SectorService overrides `_after_delete` to cascade soft-delete to tables in the sector. TableService overrides `_validate_create` to enforce code uniqueness within the branch.

**Alternatives considered**:
- Standalone services: More code duplication for standard CRUD operations.
- Single service for both: Sectors and tables have different validation rules and different cascade behaviors. Separate services are cleaner.

**Rationale**: Follows the established pattern from C-04 (CategoryService, SubcategoryService, ProductService). Each service encapsulates its entity's business rules.

### D-05: Public branches endpoint returns minimal data

**Decision**: `GET /api/public/branches` returns only `id`, `name`, `address`, `slug` for active branches. No tenant details, no sector/table counts, no internal IDs beyond what's needed for selection.

**Alternatives considered**:
- Return full branch details with sector/table counts: More useful for pwaWaiter but leaks operational data before authentication. The waiter hasn't logged in yet at this point.
- Require authentication: Breaks the pwaWaiter pre-login flow where the waiter selects a branch BEFORE logging in.

**Rationale**: The endpoint's sole purpose is branch selection in pwaWaiter's pre-login flow. Minimal data reduces exposure. After login, authenticated endpoints provide full branch details.

### D-06: Table status field is a string enum, not managed by C-07

**Decision**: `Table.status` is stored as a String column with values like "AVAILABLE", "OUT_OF_SERVICE". C-07 defines the column and default value but does NOT implement the full status state machine — that belongs to C-08 (table-sessions) which manages the runtime status transitions.

**Alternatives considered**:
- No status field in C-07: Would require a schema migration in C-08 to add it. Better to include it now since it's part of the data model.
- Full status management in C-07: Premature — status transitions depend on table sessions which don't exist yet.

**Rationale**: C-07 creates the infrastructure (column + default). C-08 implements the behavior (state machine). This avoids rework while keeping the data model complete.

## Risks / Trade-offs

- **[Risk] Assignment queries by date could grow large** → Mitigation: Index on `(sector_id, date)`. For very active restaurants, consider periodic cleanup of assignments older than 90 days (not in C-07 scope).
- **[Risk] Public branches endpoint could be abused for enumeration** → Mitigation: Rate limiting from C-03 applies globally. The endpoint returns only active branches with minimal data.
- **[Risk] Table code format is not validated** → Mitigation: The code is a free-form string. The knowledge base shows examples like "INT-01" and "BAR-03" but doesn't mandate a format. Validation would be overly restrictive for different restaurant naming conventions. Length limit (50 chars) prevents abuse.
- **[Trade-off] No Redis cache for sectors/tables** → Unlike the menu catalog, sector/table data is low-volume and changes infrequently. Caching adds complexity without meaningful performance benefit. Can be added later if needed.

## Migration Plan

- Migration 005 depends on 004 (ingredients_recipes_catalogs)
- Creates 3 tables: `branch_sector`, `app_table`, `waiter_sector_assignment`
- All tables have proper FKs with `RESTRICT` on delete (prevent orphans)
- Rollback: `downgrade()` drops tables in reverse order (assignment → table → sector)
- No data migration needed — tables start empty

## Open Questions

_(none — all design decisions are resolved based on knowledge base documentation)_
