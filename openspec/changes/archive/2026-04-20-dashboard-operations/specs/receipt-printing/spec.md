## ADDED Requirements

### Requirement: Receipt HTML Endpoint

The backend SHALL expose `GET /api/admin/checks/{check_id}/receipt` that returns a printable HTML receipt for a paid or requested `Check`. The endpoint MUST require JWT authentication and `PermissionContext.require_management()` (ADMIN or MANAGER with access to the branch that owns the check's session). The response Content-Type MUST be `text/html; charset=utf-8`.

The HTML SHALL be structured for thermal printers (58 mm or 80 mm width) and SHALL include `@media print { @page { size: 80mm auto; margin: 2mm; } body { font-family: monospace; font-size: 12px; } }`. The content SHALL include: restaurant name, branch address, date/time of print, session/table identifier, list of items with quantity + name + unit price + subtotal, subtotal, total, list of payments (method + amount), and a "Gracias por su visita" footer.

Only ASCII-safe characters SHALL be used (no emojis, no curly quotes); Spanish accents are allowed (UTF-8 encoded).

The endpoint SHALL be rate-limited to 20 requests per minute per user to avoid abuse.

#### Scenario: ADMIN requests receipt for a paid check
- **WHEN** an ADMIN sends `GET /api/admin/checks/42/receipt` for a check in their tenant
- **THEN** the response SHALL be 200 with `Content-Type: text/html; charset=utf-8` and body contains the full receipt HTML

#### Scenario: Check not found
- **WHEN** the `check_id` does not exist or belongs to another tenant
- **THEN** the response SHALL be 404 (NotFoundError) — tenant isolation via join filter

#### Scenario: MANAGER without branch access
- **WHEN** a MANAGER without access to the branch of the check's session sends the request
- **THEN** the response SHALL be 403

#### Scenario: WAITER forbidden
- **WHEN** a WAITER sends the request
- **THEN** the response SHALL be 403

#### Scenario: Rate limit exceeded
- **WHEN** a user sends more than 20 requests within a minute
- **THEN** the subsequent request SHALL return 429

#### Scenario: HTML is printable by thermal printer
- **WHEN** the response body is inspected
- **THEN** the HTML SHALL include `<style>@media print { @page { size: 80mm auto; ... } }</style>` and use monospace font

---

### Requirement: ReceiptService Domain Service

The backend SHALL implement `ReceiptService` in `backend/rest_api/services/domain/receipt_service.py` following Clean Architecture. The service SHALL expose `render(check_id: int, tenant_id: int) -> str` that:

1. Loads the `Check` with `selectinload(Check.charges)`, `selectinload(Check.payments)`, and joins `TableSession → Table → Branch` with tenant verification.
2. Builds an ordered list of items with quantity, product name (via `Charge → RoundItem → Product` or equivalent reference), unit price (cents), and subtotal (cents).
3. Renders an HTML string via a Jinja2 template or an f-string-based template (the choice is left to apply; documented in code).
4. Returns the HTML as `str`.

The service SHALL NOT commit any data; it is read-only. The router SHALL be thin and delegate all logic to the service.

#### Scenario: Service loads check with relations
- **WHEN** `render(check_id=42, tenant_id=1)` is called
- **THEN** the check SHALL be loaded with its charges and payments pre-loaded via `selectinload` (no N+1 queries)

#### Scenario: Service raises NotFoundError for cross-tenant access
- **WHEN** the check_id belongs to tenant 2 and `tenant_id=1` is passed
- **THEN** the service SHALL raise `NotFoundError("Cuenta", check_id)`

#### Scenario: Service returns valid HTML
- **WHEN** `render` is called for a check with 3 items and 1 payment
- **THEN** the returned string SHALL be a valid HTML document that includes all 3 items, the payment method and amount, and the total
