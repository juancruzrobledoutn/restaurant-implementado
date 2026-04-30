## 1. Models (backend — SQLAlchemy)

- [x] 1.1 Extender `backend/rest_api/models/customer.py`: agregar `tenant_id` (BigInteger FK, nullable inicialmente para backfill), `consent_version` (String 20, nullable), `consent_granted_at` (DateTime with timezone, nullable), `consent_ip_hash` (String 64, nullable), `opted_in` (Boolean, NOT NULL, default False); verificar que el modelo hereda `AuditMixin`
- [x] 1.2 Definir `__table_args__` con unique partial index: `Index('uq_customer_device_tenant_active', 'device_id', 'tenant_id', unique=True, postgresql_where=text('is_active = true'))`
- [x] 1.3 Agregar relación `tenant` (N:1 a `Tenant`) y `diners` (1:N a `Diner`)
- [x] 1.4 Verificar que `backend/rest_api/models/diner.py` ya tiene `customer_id` nullable (C-08); confirmar con grep. Si falta el FK real, agregarlo apuntando a `customer.id` con `ondelete='SET NULL'`
- [x] 1.5 Agregar relación bidireccional `Diner.customer` (N:1 a Customer)

## 2. Migration (Alembic)

- [x] 2.1 **[BLOQUEANTE — review humano antes de ejecutar]** Crear revision Alembic `alembic revision --autogenerate -m "customer_loyalty_and_consent_c19"`; revisar el script generado contra la spec `customer-loyalty` antes de aplicar
- [x] 2.2 Asegurar que la migración hace en este orden: (a) `ADD COLUMN tenant_id BIGINT NULL`, (b) backfill con SQL explícito (`UPDATE customer SET tenant_id = (SELECT tenant_id FROM diner WHERE diner.customer_id = customer.id LIMIT 1)`), (c) `ALTER COLUMN tenant_id SET NOT NULL`, (d) crear FK constraint, (e) crear unique partial index, (f) `ADD COLUMN consent_* y opted_in`
- [x] 2.3 Soft-delete huérfanos: `UPDATE customer SET is_active = FALSE WHERE tenant_id IS NULL` antes del SET NOT NULL (fallback si backfill no cubre todos)
- [x] 2.4 Escribir test de migración en `backend/tests/migrations/test_customer_c19.py`: upgrade sobre DB poblada, asserts de columnas existentes + NOT NULL + unique index; downgrade limpio
- [x] 2.5 Documentar en el docstring de la migración: requerida revisión humana, GDPR impact, rollback strategy

## 3. Backend services (domain layer)

- [x] 3.1 **[BLOQUEANTE — review humano — CRITICO governance]** Crear `backend/rest_api/services/customer_service.py` con `class CustomerService(BaseCRUDService[Customer, CustomerOut])`; implementar `__init__(db, tenant_id, user_ctx=None)` siguiendo el patrón de `fastapi-domain-service`
- [x] 3.2 Implementar `get_or_create_by_device(device_id, tenant_id) -> Customer`: query con `Customer.is_active.is_(True)` y `tenant_id == self.tenant_id`; si no existe, crear con `opted_in=False` y `safe_commit(db)`; idempotente
- [x] 3.3 Implementar `get_profile(customer_id, tenant_id) -> CustomerProfileOut`: query por id + tenant, retornar DTO sin raw `device_id` (solo prefix de 7 chars)
- [x] 3.4 Implementar `opt_in(customer_id, tenant_id, name, email, client_ip, consent_version) -> Customer`: validar `opted_in=False` actualmente (si no, raise `AlreadyOptedInError`), hashear IP con `sha256((client_ip + tenant_salt).encode()).hexdigest()`, setear fields, `safe_commit(db)`
- [x] 3.5 Implementar `get_visit_history(customer_id, tenant_id, branch_id=None, limit=20) -> list[VisitOut]`: join `customer → diner → table_session → round`; group by session; order by `session.created_at desc`
- [x] 3.6 Implementar `get_preferences(customer_id, tenant_id, top_n=5) -> list[PreferenceOut]`: join `customer → diner → round_item → product`; group by `product_id` y sum de quantity; order by quantity desc; limit top_n
- [x] 3.7 **[BLOQUEANTE — review humano]** Verificar que NINGÚN log incluye `name`, `email`, `device_id` raw, ni `client_ip` plain-text — usar solo `customer_id` y `tenant_id` en log messages; agregar test que grep los logs generados por `pytest --log-level=DEBUG`
- [x] 3.8 Config: leer `CONSENT_SALT` desde `shared/config/settings.py` (env var global en MVP); validar que tiene 32+ chars en `validate_production_secrets()`

## 4. Backend routers (thin HTTP layer)

- [x] 4.1 Crear `backend/rest_api/schemas/customer.py`: `CustomerOut`, `CustomerProfileOut` (sin raw device_id), `OptInIn` (name, email, consent_version, consent_granted), `VisitOut`, `PreferenceOut`
- [x] 4.2 **[BLOQUEANTE — review humano — CRITICO governance]** Crear `backend/rest_api/routers/customer.py` con `APIRouter(prefix='/api/customer')`, dependencia `current_table_context` (ya existe)
- [x] 4.3 Implementar `GET /profile` (20/min, rate_limit decorator): llama `CustomerService.get_profile(diner.customer_id, tenant_id)`; si `customer_id IS NULL` → 404 `customer_not_found`
- [x] 4.4 Implementar `POST /opt-in` (3/min): valida `consent_granted=True` (si no → 400 `consent_required`), llama `CustomerService.opt_in(...)`; 409 `already_opted_in` capturado del service
- [x] 4.5 Implementar `GET /history` (20/min): llama `CustomerService.get_visit_history`; retorna lista vacía si no hay visitas
- [x] 4.6 Implementar `GET /preferences` (20/min): llama `CustomerService.get_preferences` con `top_n=5`
- [x] 4.7 Registrar el router en `backend/rest_api/main.py` dentro de `include_router` ordenado
- [x] 4.8 **[BLOQUEANTE — review humano]** Modificar `backend/rest_api/routers/public.py` (endpoint `POST /api/public/tables/code/{code}/join`): leer flag `ENABLE_CUSTOMER_TRACKING` desde settings; si flag on y `device_id` presente, llamar `CustomerService.get_or_create_by_device()` y setear `diner.customer_id` dentro del mismo `safe_commit(db)`
- [x] 4.9 Agregar `ENABLE_CUSTOMER_TRACKING=True` a `.env.example` y `shared/config/settings.py` como bool (default True)
- [x] 4.10 Smoke-verify que `POST /api/billing/check/request` y `POST /api/billing/payment/preference` (legados de C-12) aceptan Table Token — NO tocar código existente, solo verificar con test de regresión

## 5. Backend tests (pytest)

- [x] 5.1 Test `CustomerService.get_or_create_by_device`: happy path (crea), idempotente (reutiliza), multi-tenant (mismo device en dos tenants → dos customers)
- [x] 5.2 Test `CustomerService.opt_in`: setea fields correctos, hashea IP con salt, idempotente vía `already_opted_in` (segunda llamada raise)
- [x] 5.3 Test `CustomerService.get_visit_history` respeta `tenant_id` (no cruza tenants, no incluye sesiones canceladas)
- [x] 5.4 Test `CustomerService.get_preferences` retorna top N por quantity desc
- [x] 5.5 Test `/api/customer/profile`: 200 con customer, 404 sin customer, 401 sin token, 429 rate limit con 21 requests en 60s
- [x] 5.6 Test `/api/customer/opt-in`: 201 happy path, 400 `consent_required` cuando `consent_granted=false`, 409 `already_opted_in`, 429 rate limit con 4 requests en 60s
- [x] 5.7 Test `POST /api/public/tables/code/{code}/join` con `device_id`: crea customer, linkea diner; sin `device_id`: `customer_id=NULL`; flag OFF: `customer_id=NULL`
- [x] 5.8 Test de regresión C-12 endpoints `/api/billing/check/request` y `/api/billing/payment/preference` con Table Token siguen retornando 201 (no regresión)
- [x] 5.9 **[BLOQUEANTE — review humano]** Test de PII en logs: capturar stderr durante `CustomerService.opt_in(name='TestAna', email='test@example.com', ...)`; grep debe NO encontrar `'TestAna'`, `'test@example.com'`, ni el plain IP

## 6. Frontend stores (Zustand)

- [x] 6.1 Crear `pwaMenu/src/stores/billingStore.ts`: estado con `{ checkId, status, splitMethod, totalCents, charges, payments, remainingCents, loadedAt }`, selectores con `useShallow`, `EMPTY_ARRAY` constante, acción `hydrate(sessionId)` que llama `GET /api/billing/check/{sessionId}`, acción `setCheck(check)` idempotente
- [x] 6.2 Crear `pwaMenu/src/stores/paymentStore.ts`: FSM explícita con transiciones validadas, helper `transition(from, to)`, `reset()`, log WARN con `logger.warn` en transición inválida
- [x] 6.3 Crear `pwaMenu/src/stores/customerStore.ts`: `{ profile, visitHistory, preferences, optedIn, consentVersion, loadedAt }`, acción `load()` en paralelo con `Promise.allSettled`, 404 seteando `profile=null` sin throw; NO persistencia a storage (comment explícito)
- [x] 6.4 Tests unitarios en `pwaMenu/src/tests/billingStore.test.ts`: hydrate, setCheck idempotencia, selectCanRequestCheck combinado con sessionStore mockeado
- [x] 6.5 Tests unitarios en `pwaMenu/src/tests/paymentStore.test.ts`: transiciones válidas, transiciones inválidas loggean y no mutan, reset limpia todos los campos
- [x] 6.6 Tests unitarios en `pwaMenu/src/tests/customerStore.test.ts`: load happy path, 404 graceful, no persistencia (spy en `localStorage.setItem`)

## 7. Frontend services (API + WS)

- [x] 7.1 Crear `pwaMenu/src/services/billingApi.ts`: `requestCheck(splitMethod)`, `getCheck(sessionId)`, con header `X-Table-Token` automático desde `sessionStore`, conversión int↔string en boundary
- [x] 7.2 Crear `pwaMenu/src/services/customerApi.ts`: `getProfile()`, `optIn(payload)`, `getHistory()`, `getPreferences()` con X-Table-Token
- [x] 7.3 **[BLOQUEANTE — review humano — CRITICO governance]** Crear `pwaMenu/src/services/mercadoPago.ts`: función `createPreferenceAndRedirect(checkId)` que llama `POST /api/billing/payment/preference` y hace `window.location.assign(initPoint)`; NO importar MP SDK; NO renderear ningún campo de tarjeta
- [x] 7.4 Extender `pwaMenu/src/services/ws/dinerWS.ts` (ya existe de C-18) con tipos `CheckRequestedEvent`, `CheckPaidEvent`, `PaymentApprovedEvent`, `PaymentRejectedEvent` (discriminated union sobre `type`)
- [x] 7.5 Crear `pwaMenu/src/hooks/useBillingWS.ts`: ref pattern (setup + subscribe effects); handlers registran CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED; dispatchea a `billingStore`, `paymentStore`, `sessionStore` según corresponda; usa dedup por `event_id` de C-18
- [x] 7.6 Mount `useBillingWS()` una sola vez en `pwaMenu/src/App.tsx` dentro del provider tree

## 8. Frontend pages (routes)

- [x] 8.1 Crear `pwaMenu/src/pages/CheckRequestPage.tsx` (`/check/request`): selector de split method (solo `equal_split` visible si `VITE_ENABLE_SPLIT_METHODS !== 'true'`), resumen de total, CTA "Solicitar cuenta"; maneja 409 `session_not_open` con toast, 429 enqueueando en `retryQueueStore`
- [x] 8.2 Crear `pwaMenu/src/pages/CheckStatusPage.tsx` (`/check`): renderiza `CheckSummary`, `ChargeRow` por cada cargo, `PaymentButton` (Mercado Pago); reactivo a `billingStore.status`; cuando `PAID` muestra ticket confirmación; `useBillingWS` ya hace el routing
- [x] 8.3 **[BLOQUEANTE — review humano — CRITICO governance]** Crear `pwaMenu/src/pages/PaymentResultPage.tsx` (`/payment/result`): lee `payment_id`, `preference_id`, `status` de query params; valida match con `paymentStore.paymentId` (si mismatch → `paymentStore.phase='failed'` con `errorCode='payment_mismatch'`); espera WS 30s, luego polling cada 3s por 20 intentos
- [x] 8.4 Crear `pwaMenu/src/pages/ProfilePage.tsx` (`/profile`): accesible solo si `customerStore.profile !== null` (sino redirect a `/menu`); muestra historial + top productos; si `!optedIn` muestra `OptInForm`
- [x] 8.5 Registrar las 4 rutas nuevas en `pwaMenu/src/App.tsx` dentro del `<Routes>`

## 9. Frontend components (UI)

- [x] 9.1 Crear `pwaMenu/src/components/billing/CheckSummary.tsx`: grid de cargos con total y remaining
- [x] 9.2 Crear `pwaMenu/src/components/billing/ChargeRow.tsx`: item row con diner avatar (reutilizar `DinerAvatar` de C-18)
- [x] 9.3 Crear `pwaMenu/src/components/billing/PaymentButton.tsx`: botón naranja (`#f97316`) con spinner; disabled cuando `paymentStore.phase === 'creating_preference'`; onClick llama `mercadoPago.createPreferenceAndRedirect(checkId)`
- [x] 9.4 Crear `pwaMenu/src/components/billing/PaymentStatus.tsx`: render condicional según `paymentStore.phase` (pending spinner, approved check, rejected error)
- [x] 9.5 Crear `pwaMenu/src/components/billing/ConsentBlock.tsx`: bloque de texto legal con key `consent.legalText` + checkbox NO pre-tildado + error inline si falta
- [x] 9.6 Crear `pwaMenu/src/components/billing/OptInForm.tsx` usando React 19 `useActionState`: fields name (required, 2+ chars), email (required, regex), ConsentBlock; submit llama `customerApi.optIn`; manejo de 400/409/201 como spec; usar skill `react19-form-pattern`
- [x] 9.7 Tests de componentes en `pwaMenu/src/tests/OptInForm.test.tsx`: checkbox no pre-checked inicial, block submit sin consent, navegación a /profile en 201

## 10. i18n (es/en/pt)

- [x] 10.1 Agregar ~60 keys nuevas en `pwaMenu/src/i18n/locales/es.json` bajo namespaces `check`, `payment`, `customer`, `consent`, `errors.billing`
- [x] 10.2 Duplicar en `en.json` y `pt.json` con traducciones correctas (no placeholders `[TODO]`)
- [x] 10.3 **[BLOQUEANTE — review legal]** Marcar `consent.legalText` y `consent.body` con flag `needs_legal_review: true` en metadata; documentar en el PR que requieren aprobación legal explícita antes del apply
- [x] 10.4 Extender script de parity `pwaMenu/scripts/check-i18n-parity.js` (o equivalente creado en C-18) para fallar CI si una key de `check/*`, `payment/*`, `customer/*`, `consent/*`, `errors.billing.*` falta en algún locale
- [x] 10.5 Test de snapshot de keys en `pwaMenu/src/tests/i18n.test.ts`

## 11. Frontend — Vite env + infra

- [x] 11.1 Agregar a `pwaMenu/.env.example`: `VITE_MP_PUBLIC_KEY=APP_USR-your-public-key` (con comentario: NO commitear la real), `VITE_MP_RETURN_URL=http://localhost:5176/payment/result`, `VITE_ENABLE_SPLIT_METHODS=false`
- [x] 11.2 **[BLOQUEANTE — review humano]** Actualizar `devOps/docker-compose.yml` para propagar `VITE_MP_PUBLIC_KEY` al build stage de pwaMenu (como build arg, no runtime env)
- [x] 11.3 Verificar en `pwaMenu/vite.config.ts` que los prefijos `VITE_MP_*` están permitidos (ya debería estar por default)
- [x] 11.4 Agregar a `CLAUDE.md` (sección Variables críticas): `VITE_MP_PUBLIC_KEY` y `VITE_MP_RETURN_URL` como requeridos para pwaMenu
- [x] 11.5 **[BLOQUEANTE — review humano]** Script de post-build que greppea el bundle generado en `pwaMenu/dist/assets/*.js` por patrones `card_number|cvv|cardholder|/v1/card_tokens` y falla el build si encuentra match (defensa contra regresión PCI)

## 12. E2E + sign-off

- [x] 12.1 Tests E2E en `pwaMenu/e2e/billing.spec.ts` (Playwright): join con device_id → profile existe → request check → ver `/check` con charges → click Pagar MP → mock redirect a `/payment/result?status=approved&payment_id=...` → ver estado APPROVED → check PAID → session CLOSED
- [x] 12.2 Test E2E de opt-in: diner entra sin opt-in → va a `/profile` → completa OptInForm → customer.opted_in = true vía `GET /api/customer/profile` → reflejado en UI
- [x] 12.3 Test E2E de fallback polling: mockear WS que NO emite `PAYMENT_APPROVED`; verificar que polling resuelve el pago con `GET /api/billing/payment/:id/status` en el 3er intento
- [x] 12.4 Test E2E de rechazo de pago: MP redirect con `status=rejected`; UI muestra `payment.rejected.*` y CTA retry
- [x] 12.5 Ejecutar `openspec validate pwamenu-billing --strict` — cero errores antes de cerrar tasks
- [x] 12.6 Ejecutar skill `requesting-code-review` para review interno — adjuntar veredicto al PR; governance CRITICO requiere segunda aprobación humana (manager o seguridad)
- [x] 12.7 **[BLOQUEANTE — governance CRITICO — APROBADO 2026-04-27]** Obtener aprobación humana explícita antes del merge a main: (a) revisión de seguridad (PII, PCI boundary, webhook signature), (b) revisión legal (textos de consent en es/en/pt), (c) revisión de infra (env vars, docker-compose changes)
- [x] 12.8 Documentar en `knowledge-base/03-seguridad/` los gaps conocidos: (a) retiro de consent no implementado (DELETE /opt-in), (b) reversal/chargeback MP fuera de scope, (c) PCI boundary documentado como redirect-only
