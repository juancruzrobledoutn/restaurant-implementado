# tenant-settings Specification

## Purpose
TBD - created by archiving change dashboard-settings. Update Purpose after archive.
## Requirements
### Requirement: GET tenant settings endpoint

The system SHALL provide `GET /api/admin/tenants/me` that returns the settings of the tenant the authenticated user belongs to. The endpoint MUST require ADMIN role. The response SHALL include `id` and `name`, and MUST NOT include `privacy_salt` or any other security-sensitive field.

#### Scenario: ADMIN reads own tenant settings
- **WHEN** an authenticated ADMIN sends `GET /api/admin/tenants/me`
- **THEN** the backend returns HTTP 200 with `{id, name}` of their tenant

#### Scenario: MANAGER attempts access
- **WHEN** an authenticated MANAGER (not ADMIN) sends `GET /api/admin/tenants/me`
- **THEN** the backend returns HTTP 403

#### Scenario: Response excludes privacy_salt
- **WHEN** an ADMIN reads tenant settings
- **THEN** the response payload does NOT contain the key `privacy_salt` regardless of tenant model internal fields

### Requirement: PATCH tenant settings endpoint

The system SHALL provide `PATCH /api/admin/tenants/me` that accepts a partial update with `name`. The endpoint MUST require ADMIN role. Request body SHALL be validated with Pydantic; `name` length must be 2–255 chars and non-blank.

#### Scenario: ADMIN updates tenant name
- **WHEN** an ADMIN sends `PATCH /api/admin/tenants/me` with `{"name": "Nuevo Nombre"}`
- **THEN** the backend updates the tenant row via the service and returns HTTP 200 with the updated settings

#### Scenario: Non-admin rejected
- **WHEN** a MANAGER sends the PATCH request
- **THEN** the backend returns HTTP 403 without modifying data

#### Scenario: Blank name rejected
- **WHEN** the PATCH body contains `{"name": "   "}`
- **THEN** the backend returns HTTP 422 with field error on `name`

### Requirement: Tenant settings service layer

A Domain Service `TenantSettingsService` SHALL encapsulate the business logic for reading and updating tenant settings. The router MUST NOT contain business logic. Every query SHALL be scoped by `tenant_id = current_user.tenant_id` — the endpoint MUST NOT accept a tenant id from the path or body for the `/me` endpoint.

#### Scenario: Service never accesses another tenant
- **WHEN** `TenantSettingsService.update` is called
- **THEN** it uses the `tenant_id` from the injected current user, never from request input

#### Scenario: safe_commit used
- **WHEN** `TenantSettingsService.update` persists
- **THEN** it calls `safe_commit(db)`

