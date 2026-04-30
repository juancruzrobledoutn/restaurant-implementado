## ADDED Requirements

### Requirement: Promotion model
The system SHALL store promotions in table `promotion` with fields: `id` (BigInteger PK), `tenant_id` (FK to app_tenant, RESTRICT on delete), `name` (String 255, not null), `description` (String 1000, nullable), `price` (Integer, cents, not null, >= 0), `start_date` (Date, not null), `start_time` (Time, not null, default 00:00:00), `end_date` (Date, not null), `end_time` (Time, not null, default 23:59:59), `promotion_type_id` (BigInteger, nullable — FK deferred to future catalog change), `is_active` (Boolean, default True), plus `AuditMixin` fields. Index on `tenant_id`.

#### Scenario: Create a promotion
- **WHEN** a `Promotion` is created with `tenant_id=1, name="2x1 Pizzas", price=12000, start_date=2026-05-01, end_date=2026-05-31`
- **THEN** the row SHALL be persisted in `promotion` with `is_active=True`

#### Scenario: Validate date range
- **WHEN** creating a promotion with `start_date=2026-05-31` and `end_date=2026-05-01`
- **THEN** the service SHALL raise `ValidationError` with HTTP 422

#### Scenario: Price must be non-negative cents
- **WHEN** creating a promotion with `price=-100`
- **THEN** the service SHALL raise `ValidationError` with HTTP 422

---

### Requirement: PromotionBranch junction
The system SHALL store the M:N relationship between promotions and branches in table `promotion_branch` with fields: `id` (BigInteger PK), `promotion_id` (FK to promotion, CASCADE on delete), `branch_id` (FK to branch, CASCADE on delete). UniqueConstraint on `(promotion_id, branch_id)`. Indexes on both FKs.

#### Scenario: Link a promotion to a branch
- **WHEN** the service calls `link_branch(promotion_id=5, branch_id=1)`
- **THEN** a `PromotionBranch(promotion_id=5, branch_id=1)` row SHALL be created

#### Scenario: Duplicate link is idempotent
- **WHEN** `link_branch(5, 1)` is called twice
- **THEN** the second call SHALL be a no-op (ON CONFLICT DO NOTHING) and return the existing row

#### Scenario: Cross-tenant link is rejected
- **WHEN** `link_branch(promotion_id=5, branch_id=999)` is called with branch 999 belonging to a different tenant than promotion 5
- **THEN** the service SHALL raise `ForbiddenError` with HTTP 403

---

### Requirement: PromotionItem junction
The system SHALL store the M:N relationship between promotions and products in table `promotion_item` with fields: `id` (BigInteger PK), `promotion_id` (FK to promotion, CASCADE on delete), `product_id` (FK to product, CASCADE on delete). UniqueConstraint on `(promotion_id, product_id)`. Indexes on both FKs.

#### Scenario: Link a product to a promotion
- **WHEN** the service calls `link_product(promotion_id=5, product_id=42)`
- **THEN** a `PromotionItem(promotion_id=5, product_id=42)` row SHALL be created

#### Scenario: Product must belong to same tenant as promotion
- **WHEN** `link_product(promotion_id=5, product_id=42)` is called with product 42 in a subcategory→category→branch→tenant different from promotion 5's tenant
- **THEN** the service SHALL raise `ForbiddenError` with HTTP 403

---

### Requirement: PromotionService
The system SHALL provide a `PromotionService` with `create`, `update`, `soft_delete`, `list_for_tenant`, `list_for_branch`, `get_by_id`, `link_branch`, `unlink_branch`, `link_product`, `unlink_product`. All operations MUST be tenant-scoped. Soft delete sets `is_active=False` on `Promotion` only; junction rows are NOT cascade-soft-deleted (kept for history).

#### Scenario: Soft delete a promotion
- **WHEN** `PromotionService.soft_delete(promotion_id=5)` is called by an ADMIN
- **THEN** `Promotion.is_active` SHALL become False and `deleted_at`/`deleted_by_id` set

#### Scenario: list_for_branch includes expired promotions
- **WHEN** `PromotionService.list_for_branch(branch_id=1)` is called on 2026-06-01
- **AND** branch 1 has a promotion with `end_date=2026-05-31` (expired)
- **THEN** the result SHALL include that promotion (filtering by temporal validity is the caller's responsibility)

---

### Requirement: Admin promotion CRUD endpoints
The system SHALL expose endpoints under `/api/admin/promotions`. Create/update/link/unlink operations MUST require `PermissionContext.require_management()`. Delete MUST require ADMIN only. List MUST support pagination and `branch_id` filter.

#### Scenario: Create a promotion and link to branches/products
- **WHEN** an ADMIN sends `POST /api/admin/promotions` with `{name, price, start_date, end_date, branch_ids: [1, 2], product_ids: [42, 43]}`
- **THEN** the system SHALL create the `Promotion` row, insert rows in `promotion_branch` for each branch, insert rows in `promotion_item` for each product, and return 201 with the full object including nested branches/items

#### Scenario: GET /api/admin/promotions paginated
- **WHEN** an ADMIN sends `GET /api/admin/promotions?branch_id=1&limit=20&offset=0`
- **THEN** the system SHALL return paginated active promotions linked to branch 1

#### Scenario: PATCH updates metadata but not relationships
- **WHEN** an ADMIN sends `PATCH /api/admin/promotions/5` with `{name: "New name"}`
- **THEN** the system SHALL update only the Promotion fields, NOT the junction tables

#### Scenario: Link a branch via dedicated endpoint
- **WHEN** an ADMIN sends `POST /api/admin/promotions/5/branches` with `{branch_id: 3}`
- **THEN** the system SHALL create a `PromotionBranch(promotion_id=5, branch_id=3)` row (idempotent) and return 201

#### Scenario: Unlink a branch
- **WHEN** an ADMIN sends `DELETE /api/admin/promotions/5/branches/3`
- **THEN** the system SHALL hard-delete the `PromotionBranch` row and return 204

#### Scenario: MANAGER cannot delete promotions
- **WHEN** a MANAGER sends `DELETE /api/admin/promotions/5`
- **THEN** the system SHALL return 403 Forbidden
