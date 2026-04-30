## ADDED Requirements

### Requirement: Branch model includes operational fields

The `Branch` SQLAlchemy model SHALL include the columns `phone` (VARCHAR(50), nullable), `timezone` (VARCHAR(64), NOT NULL, default `America/Argentina/Buenos_Aires`), and `opening_hours` (JSONB, nullable). Existing rows at migration time SHALL receive the default timezone.

#### Scenario: Migration adds columns with defaults
- **WHEN** the Alembic migration is applied to a database with existing branches
- **THEN** every existing branch row has `timezone='America/Argentina/Buenos_Aires'`, `phone=NULL`, `opening_hours=NULL`

#### Scenario: Migration downgrade removes columns
- **WHEN** the migration is downgraded
- **THEN** the three columns are dropped and any data in them is lost (documented limitation)

### Requirement: GET branch settings endpoint

The system SHALL provide `GET /api/admin/branches/{branch_id}/settings` that returns the current settings of a branch. The endpoint MUST require an authenticated user with MANAGER or ADMIN role and access to the given branch. The response schema SHALL include `id`, `name`, `slug`, `address`, `phone`, `timezone`, `opening_hours`.

#### Scenario: MANAGER reads settings of assigned branch
- **WHEN** an authenticated MANAGER with access to branch 5 sends `GET /api/admin/branches/5/settings`
- **THEN** the backend returns HTTP 200 with the branch settings payload

#### Scenario: MANAGER without access to branch
- **WHEN** an authenticated MANAGER with NO access to branch 5 sends `GET /api/admin/branches/5/settings`
- **THEN** the backend returns HTTP 403

#### Scenario: WAITER attempts access
- **WHEN** an authenticated WAITER sends `GET /api/admin/branches/5/settings`
- **THEN** the backend returns HTTP 403

#### Scenario: Branch of another tenant
- **WHEN** a MANAGER of tenant A sends `GET /api/admin/branches/{id}/settings` for a branch belonging to tenant B
- **THEN** the backend returns HTTP 404 (NOT 403 — reveals nothing)

### Requirement: PATCH branch settings endpoint

The system SHALL provide `PATCH /api/admin/branches/{branch_id}` that accepts a partial update with any subset of `name`, `slug`, `address`, `phone`, `timezone`, `opening_hours`. The endpoint MUST require MANAGER or ADMIN role and branch access. The request body SHALL be validated with a Pydantic schema; any invalid field yields HTTP 422 with per-field errors.

#### Scenario: Update branch name succeeds
- **WHEN** a MANAGER sends `PATCH /api/admin/branches/5` with `{"name": "Nueva Sucursal"}`
- **THEN** the backend updates the `name`, calls `safe_commit`, and returns HTTP 200 with the full updated settings payload

#### Scenario: Slug regex validation
- **WHEN** a PATCH body contains `"slug": "Invalid Slug!"`
- **THEN** the backend returns HTTP 422 with field error matching `slug must be kebab-case (lowercase letters, digits, hyphens), 3–60 chars`

#### Scenario: Slug uniqueness per tenant
- **WHEN** a PATCH attempts to set `slug` to a value already used by another branch of the same tenant
- **THEN** the backend returns HTTP 409 with `{"detail": "Slug already in use"}`

#### Scenario: Timezone validation
- **WHEN** a PATCH body contains `"timezone": "Mars/Phobos"`
- **THEN** the backend validates the value with `zoneinfo.ZoneInfo` and returns HTTP 422 if it fails

#### Scenario: Opening hours shape validation
- **WHEN** a PATCH body contains `opening_hours` with keys other than `mon..sun`, or intervals with `open >= close`, or overlapping intervals on the same day
- **THEN** the backend returns HTTP 422 with a specific field error

#### Scenario: Opening hours empty day
- **WHEN** a day in `opening_hours` is an empty array `[]`
- **THEN** the backend treats that day as closed and persists the empty array

#### Scenario: Opening hours 24h
- **WHEN** a day contains `[{"open": "00:00", "close": "24:00"}]`
- **THEN** the backend accepts it as a valid 24-hour day

### Requirement: Slug change invalidates menu cache

When `PATCH /api/admin/branches/{branch_id}` changes the `slug` field, the Domain Service SHALL invalidate the Redis menu cache entries for both the old and the new slug after the commit succeeds. Failure of the cache invalidation MUST NOT fail the request (log warning and continue).

#### Scenario: Cache invalidated on slug change
- **WHEN** a branch with slug `old-name` is updated to slug `new-name`
- **THEN** after the DB commit, the service deletes cache keys for both `old-name` and `new-name`
- **AND** the response returns HTTP 200 regardless of cache state

#### Scenario: Cache invalidation fails silently
- **WHEN** Redis is unreachable during invalidation
- **THEN** the service logs a warning with `{event: "menu_cache_invalidate_failed", slug_old, slug_new}` and still returns HTTP 200

### Requirement: Branch settings service layer

A Domain Service `BranchSettingsService` SHALL encapsulate the business logic: fetching, validating, updating, and invalidating cache. The router MUST NOT contain business logic beyond HTTP mapping. The service MUST filter every query by `tenant_id` and use `safe_commit`.

#### Scenario: Service rejects cross-tenant access
- **WHEN** `BranchSettingsService.get_settings` is called with a branch_id belonging to another tenant
- **THEN** the service returns `None` and the router maps it to HTTP 404

#### Scenario: Service uses safe_commit
- **WHEN** `BranchSettingsService.update_settings` successfully persists changes
- **THEN** it calls `safe_commit(db)`, not `db.commit()`
