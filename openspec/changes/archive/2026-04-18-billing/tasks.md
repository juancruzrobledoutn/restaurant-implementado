## 1. SQLAlchemy Models

- [x] 1.1 Create `backend/rest_api/models/billing.py` with `Check` model (`__tablename__ = "app_check"`, fields: id, session_id FK, branch_id FK denorm, tenant_id FK denorm, total_cents int, status str default REQUESTED, AuditMixin)
- [x] 1.2 Add `Charge` model in `billing.py` (fields: id, check_id FK, diner_id FK nullable, amount_cents int, description str nullable, created_at, is_active)
- [x] 1.3 Add `Payment` model in `billing.py` (fields: id, check_id FK, amount_cents int, method str, status str default PENDING, external_id str nullable, created_at, is_active)
- [x] 1.4 Add `Allocation` model in `billing.py` (fields: id, charge_id FK, payment_id FK, amount_cents int)
- [x] 1.5 Add CHECK constraints: `charge.amount_cents > 0`, `payment.amount_cents > 0`, `allocation.amount_cents > 0`
- [x] 1.6 Add partial unique index on `payment.external_id WHERE external_id IS NOT NULL`
- [x] 1.7 Add unique constraint on `app_check.session_id` (one check per session)
- [x] 1.8 Add indexes: `charge(check_id)`, `payment(check_id)`, `allocation(charge_id, payment_id)`
- [x] 1.9 Add SQLAlchemy relationships: `Check.charges`, `Check.payments`, `Charge.allocations`, `Payment.allocations`, `Check.session` (back-populate)
- [x] 1.10 Register `billing.py` models in `backend/rest_api/models/__init__.py`

## 2. Pydantic Schemas

- [x] 2.1 Create `backend/rest_api/schemas/billing.py` with `CheckOut` (id, session_id, total_cents, status, created_at, charges, payments)
- [x] 2.2 Add `ChargeOut` schema (id, check_id, diner_id nullable, amount_cents, description, remaining_cents computed)
- [x] 2.3 Add `PaymentOut` schema (id, check_id, amount_cents, method, status, external_id, created_at, allocations)
- [x] 2.4 Add `AllocationOut` schema (id, charge_id, payment_id, amount_cents)
- [x] 2.5 Add `CheckRequestBody` schema (split_method: Literal["equal_split", "by_consumption", "custom"], custom_split: dict[int, int] | None)
- [x] 2.6 Add `ManualPaymentBody` schema (session_id: int, amount_cents: int, method: Literal["cash","card","transfer"], reference: str | None)
- [x] 2.7 Add `MPPreferenceBody` schema (check_id: int) and `MPPreferenceOut` (preference_id: str, init_point: str)
- [x] 2.8 Add `PaymentStatusOut` schema (id, status, amount_cents, method)

## 3. PaymentGateway Abstraction

- [x] 3.1 Create `backend/rest_api/services/payment_gateway.py` with `PaymentGateway` ABC (abstract methods: `create_preference(check, items) -> MPPreferenceOut`, `verify_webhook(payload, signature) -> WebhookEvent`)
- [x] 3.2 Define `WebhookEvent` dataclass (external_id: str, status: str, amount_cents: int)
- [x] 3.3 Create `backend/rest_api/services/mercadopago_gateway.py` implementing `MercadoPagoGateway(PaymentGateway)`
- [x] 3.4 Implement `MercadoPagoGateway.create_preference()` using `mercadopago` SDK — build `PreferenceRequest` with items, back_urls, auto_return
- [x] 3.5 Implement `MercadoPagoGateway.verify_webhook()` — HMAC-SHA256 signature verification with `MERCADOPAGO_WEBHOOK_SECRET`
- [x] 3.6 Add `get_payment_gateway()` FastAPI dependency factory in `backend/rest_api/dependencies.py`
- [x] 3.7 Add startup validation: raise `ConfigurationError` if `MERCADOPAGO_ACCESS_TOKEN` is unset or empty
- [x] 3.8 Add `mercadopago` to `backend/requirements.txt`

## 4. BillingService — Core Logic

- [x] 4.1 Create `backend/rest_api/services/billing_service.py` with `BillingService` extending `BaseCRUDService`
- [x] 4.2 Implement `request_check(session_id, split_method, db, custom_split=None)`: validate session OPEN, compute total from round items, calculate charges by split method, create `app_check` + charges, set `session.status='PAYING'`, write `CHECK_REQUESTED` Outbox event, call `safe_commit(db)`
- [x] 4.3 Implement `_split_equal(total_cents, diners)` — distributes total, last diner absorbs rounding residual
- [x] 4.4 Implement `_split_by_consumption(session_id, db)` — groups round items by `diner_id`, shared items split equally
- [x] 4.5 Implement `_split_custom(total_cents, custom_split)` — validates sum equals total_cents, raises 400 if mismatch
- [x] 4.6 Implement `_allocate(payment, db)` — SELECT FOR UPDATE charges with remaining > 0, ORDER BY created_at ASC; iterate creating allocation rows until payment amount exhausted
- [x] 4.7 Implement `_remaining_cents(charge_id, db)` — returns `charge.amount_cents - SUM(allocation.amount_cents WHERE charge_id=...)` via DB query
- [x] 4.8 Implement `_resolve_check(check, session, db)` — if all charges fully covered: set `check.status='PAID'`, `session.status='CLOSED'`, `session.is_active=False`, write `CHECK_PAID` Outbox event
- [x] 4.9 Implement `register_manual_payment(check_id, amount_cents, method, db, reference=None)`: validate check REQUESTED, create `payment` with status APPROVED, call `_allocate()`, write `PAYMENT_APPROVED` Outbox event, call `_resolve_check()`, call `safe_commit(db)`
- [x] 4.10 Implement `process_mp_webhook(external_id, mp_status, amount_cents, db)`: idempotency check on `external_id`, update payment status, run `_allocate()` if APPROVED, call `_resolve_check()` if full, write Outbox event, call `safe_commit(db)`
- [x] 4.11 Implement `create_mp_preference(check_id, db, gateway)`: validate check REQUESTED, create `payment` with status PENDING, call `gateway.create_preference()`, return preference
- [x] 4.12 Implement `get_check(session_id, db)`: return `app_check` with charges (including remaining_cents) and payments
- [x] 4.13 Add multi-tenant guard in every service method: verify `check.tenant_id == current_user.tenant_id` before any operation

## 5. Outbox Event Helpers

- [x] 5.1 Add `write_billing_outbox_event(db, tenant_id, branch_id, event_type, payload)` helper in `backend/rest_api/services/outbox_service.py` (extend existing helper from C-10)
- [x] 5.2 Add event type constants: `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED` to `shared/config/constants.py`

## 6. Rate Limiting

- [x] 6.1 Create `billing_rate_limit` FastAPI dependency using existing Redis+Lua mechanism from C-03
- [x] 6.2 Configure three tiers: `check_request` (5/min), `payment_ops` (20/min), `critical` (5/min)
- [x] 6.3 Apply rate limits per endpoint in router decorators

## 7. Billing Router

- [x] 7.1 Create `backend/rest_api/routers/billing.py` with `APIRouter(prefix="/api/billing")`
- [x] 7.2 Implement `POST /api/billing/check/request` (JWT or Table Token, 5/min rate limit): call `BillingService.request_check()`, return 201 with `CheckOut`
- [x] 7.3 Implement `GET /api/billing/check/{session_id}` (JWT or Table Token, 20/min): call `BillingService.get_check()`, return 200 with full `CheckOut` including charges and payments
- [x] 7.4 Implement `POST /api/billing/payment/preference` (JWT or Table Token, 5/min): call `BillingService.create_mp_preference()`, return 200 with `MPPreferenceOut`
- [x] 7.5 Implement `POST /api/billing/payment/webhook` (no auth, 5/min): verify signature via `gateway.verify_webhook()`, call `BillingService.process_mp_webhook()`, return 200
- [x] 7.6 Implement `GET /api/billing/payment/{id}/status` (JWT or Table Token, 20/min): return `PaymentStatusOut`
- [x] 7.7 Register `billing.py` router in `backend/rest_api/main.py`

## 8. Waiter Router Extensions

- [x] 8.1 Add `POST /api/waiter/sessions/{session_id}/check` to `backend/rest_api/routers/waiter.py` (JWT WAITER/MANAGER/ADMIN, 5/min): delegates to `BillingService.request_check()` with default `equal_split`, returns 201 with `CheckOut`
- [x] 8.2 Add `POST /api/waiter/payments/manual` to waiter router (JWT WAITER/MANAGER/ADMIN, 20/min): delegates to `BillingService.register_manual_payment()`, returns 200 with `PaymentOut`
- [x] 8.3 Update `POST /api/waiter/tables/{table_id}/close` handler: check if session `status='PAYING'` and check `status='REQUESTED'` → return 409; if session is `CLOSED` (billing resolved) → perform cleanup (hard-delete cart_items, set table `status='AVAILABLE'`), return 200

## 9. TableSessionService Update

- [x] 9.1 Remove (or make private) any direct `session.status = 'PAYING'` from `TableSessionService.request_check()` — this transition now belongs exclusively to `BillingService.request_check()`
- [x] 9.2 Remove direct `PAYING → CLOSED` transition from `TableSessionService.close()` — replace with guard: raise 409 if check exists and is not PAID
- [x] 9.3 Add `TableSessionService.cleanup_after_close(session_id, db)` — hard-deletes cart_items, resets table status to AVAILABLE; called by the close endpoint after billing has resolved

## 10. Alembic Migration 009

- [x] 10.1 Generate migration: `alembic revision --autogenerate -m "009_billing"`
- [x] 10.2 Verify `down_revision = "008_kitchen"` in generated file
- [x] 10.3 Review and clean up autogenerated `upgrade()`: ensure table creation order (`app_check` → `charge` → `payment` → `allocation`), all FKs `ondelete=RESTRICT`, all indexes, partial unique index on `payment.external_id`
- [x] 10.4 Write manual `downgrade()`: drop in reverse order (`allocation` → `payment` → `charge` → `app_check`)
- [x] 10.5 Run `alembic upgrade head` against test DB and verify all tables exist with correct schema
- [x] 10.6 Run `alembic downgrade 008_kitchen` and verify clean rollback

## 11. Environment Variables

- [x] 11.1 Add `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET` to `backend/.env.example`
- [x] 11.2 Add these vars to `backend/shared/config/settings.py` with validation (startup fail if `MERCADOPAGO_WEBHOOK_SECRET` is missing in non-test environments)
- [x] 11.3 Add test-environment override in `backend/pytest.ini` or conftest to set dummy MP credentials

## 12. Tests — Unit

- [x] 12.1 Create `backend/tests/test_billing_fifo.py` — test `_allocate()` logic in isolation: single payment covers multiple charges, multiple payments cover one charge, partial coverage stops correctly
- [x] 12.2 Test `_split_equal()`: 3 diners with total 1001 → [333, 333, 335]
- [x] 12.3 Test `_split_custom()`: valid sum passes, invalid sum raises 400
- [x] 12.4 Test `_remaining_cents()`: returns correct value with existing allocations
- [x] 12.5 Test `MercadoPagoGateway.verify_webhook()` with valid and invalid HMAC signatures

## 13. Tests — Integration

- [x] 13.1 Create `backend/tests/test_billing.py` — fixture: running session (OPEN) with 3 diners and 3 served rounds
- [x] 13.2 Test `POST /api/billing/check/request`: session transitions to PAYING, check created with REQUESTED, charges generated correctly, `CHECK_REQUESTED` in outbox
- [x] 13.3 Test `POST /api/billing/check/request` when already PAYING: returns 409
- [x] 13.4 Test `POST /api/waiter/payments/manual` — full payment: check becomes PAID, session becomes CLOSED, `PAYMENT_APPROVED` + `CHECK_PAID` in outbox
- [x] 13.5 Test `POST /api/waiter/payments/manual` — partial payment: check stays REQUESTED, allocations correct, no session close
- [x] 13.6 Test `POST /api/waiter/payments/manual` — two partial payments complete the check: second payment triggers `_resolve_check()`
- [x] 13.7 Test `POST /api/billing/payment/webhook` — approved: payment APPROVED, FIFO runs, check resolves if full
- [x] 13.8 Test `POST /api/billing/payment/webhook` — duplicate external_id: idempotent, no duplicate allocations
- [x] 13.9 Test `POST /api/billing/payment/webhook` — rejected: payment REJECTED, `PAYMENT_REJECTED` in outbox
- [x] 13.10 Test `POST /api/billing/payment/webhook` — invalid HMAC signature: returns 400
- [x] 13.11 Test `POST /api/waiter/tables/{id}/close` when check is REQUESTED: returns 409
- [x] 13.12 Test `POST /api/waiter/tables/{id}/close` after billing resolved (session CLOSED): returns 200, table AVAILABLE
- [x] 13.13 Test `GET /api/billing/check/{session_id}`: returns check with charges, payments, and remaining_cents per charge
- [x] 13.14 Test KITCHEN role denied on `POST /api/waiter/payments/manual`: returns 403
- [x] 13.15 Test multi-tenant isolation: user from tenant A cannot access check from tenant B

## 14. Tests — Rate Limiting

- [x] 14.1 Test `POST /api/billing/check/request` rate limit: 6th request in 60s returns 429
- [x] 14.2 Test that check request limit does not share bucket with payment ops limit

## 15. Validation and Integration Check

- [x] 15.1 Run full backend test suite: `cd backend && pytest` — assert 0 failures, 0 regressions against previous total
- [x] 15.2 Run `openspec validate --change billing` — assert no schema violations
