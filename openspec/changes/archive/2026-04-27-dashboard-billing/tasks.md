## 1. Preparación

- [x] 1.1 Leer `.agents/SKILLS.md` y cargar todas las skills aplicables al apply (mínimo: `clean-architecture`, `fastapi-domain-service`, `fastapi-code-review`, `dashboard-crud-page`, `zustand-store-pattern`, `ws-frontend-subscription`, `vercel-react-best-practices`, `help-system-content`, `react19-form-pattern`, `test-driven-development`, `python-testing-patterns`, `api-security-best-practices`)
- [x] 1.2 Leer `knowledge-base/01-negocio/04_reglas_de_negocio.md` §7 (Reglas de Facturación) y `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` (shape de payloads Outbox `CHECK_*` / `PAYMENT_*`)
- [x] 1.3 Inspeccionar la implementación actual de C-12 en `backend/rest_api/routers/billing.py`, `backend/rest_api/services/domain/billing_service.py`, `backend/rest_api/schemas/billing.py` y `backend/rest_api/models/` (modelos `Check`, `Charge`, `Allocation`, `Payment`) para reutilizar repositorios y schemas
- [x] 1.4 Confirmar el payload exacto del evento Outbox `CHECK_PAID` (Open Question #1 del design.md) leyendo el publisher en `backend/rest_api/services/outbox/` — decidir si el handler WS necesita refetch post-evento

## 2. Backend — schemas de billing-admin-api

- [x] 2.1 Crear `backend/rest_api/schemas/admin_billing.py` con `CheckSummaryOut { id, session_id, branch_id, total_cents, covered_cents, status, created_at }`, `PaginatedChecksOut`, `PaymentSummaryOut { id, check_id, amount_cents, method, status, external_id, created_at }`, `PaginatedPaymentsOut`
- [x] 2.2 Definir validadores de query params en el router (Pydantic dependency): `AdminChecksQuery { branch_id: int, from_: date = today, to: date = today, status: Literal["REQUESTED","PAID"] | None, page: int = 1, page_size: int = Field(default=20, ge=1, le=100) }` y análogo `AdminPaymentsQuery`
- [x] 2.3 Agregar test de schema que verifica `page_size` clamped a 100 y `from`/`to` default a `today`

## 3. Backend — AdminBillingService

- [x] 3.1 Crear `backend/rest_api/services/domain/admin_billing_service.py` con la clase `AdminBillingService(db: AsyncSession)` e importar los repositorios existentes (`check_repository`, `payment_repository`, `charge_repository`, `allocation_repository`) — zero duplicación de lógica FIFO
- [x] 3.2 Implementar `list_checks(tenant_id, branch_id, from_, to, status, page, page_size) -> PaginatedChecksOut`: validar rango ≤ 90 días (raise `ValidationError` si no), construir query con `WHERE tenant_id AND branch_id AND created_at BETWEEN ... [AND status]` ordenado por `created_at DESC`, LIMIT/OFFSET, y calcular `covered_cents` con una subquery correlacionada o función window (evitar N+1)
- [x] 3.3 Implementar `list_payments(tenant_id, branch_id, from_, to, method, status, page, page_size) -> PaginatedPaymentsOut`: join `payment` con `app_check` para filtrar por `branch_id` + `tenant_id`, aplicar filtros opcionales `method` y `status`, ordenar `DESC`, paginar
- [x] 3.4 Tests unitarios (`backend/tests/test_admin_billing_service.py`): rango > 90 días → ValidationError; aislamiento tenant (tenant A no ve tenant B); aislamiento branch (branch 42 no ve branch 99); filtros `status`/`method` filtran correctamente; `covered_cents` se calcula correcto para casos 0 alloc, alloc parcial y alloc total; orden `created_at DESC`; paginación devuelve `total`, `total_pages` correcto
- [x] 3.5 Test N+1: usando `sqlalchemy.event.listens_for("before_cursor_execute")`, contar que `list_checks` para 20 checks ejecuta ≤ 3 queries (1 count, 1 select principal, 1 para covered_cents via subquery)

## 4. Backend — router admin_billing

- [x] 4.1 Crear `backend/rest_api/routers/admin_billing.py` con `router = APIRouter(prefix="/admin", tags=["admin-billing"])`, endpoints thin que sólo llaman `AdminBillingService` y mapean excepciones (`ValidationError → 409`, `NotFoundError → 404`)
- [x] 4.2 Implementar `GET /admin/checks` con dependencias `current_user`, `PermissionContext.require_management()`, `limiter.limit("60/minute")`, validación de `branch_id ∈ user.branch_ids` (si `user.role != ADMIN`, MANAGER sólo sus branches)
- [x] 4.3 Implementar `GET /admin/payments` con las mismas guardas
- [x] 4.4 Registrar el router en `backend/rest_api/app.py` bajo el prefijo `/api`
- [x] 4.5 Tests de router (`backend/tests/test_admin_billing_router.py`): ADMIN 200, MANAGER sucursal propia 200, MANAGER sucursal ajena 403, WAITER 403, KITCHEN 403, 401 sin token, 429 al exceder rate limit (60/min); response shape cumple `PaginatedChecksOut` / `PaginatedPaymentsOut`

## 5. Frontend — servicios API

- [x] 5.1 Crear `Dashboard/src/services/billingAdminAPI.ts` con funciones `listChecks(params)` y `listPayments(params)` que llaman a `/api/admin/checks` y `/api/admin/payments` respectivamente, reusando el cliente HTTP existente (con interceptor de JWT)
- [x] 5.2 Agregar tipos a `Dashboard/src/types/billing.ts`: `CheckSummary`, `PaymentSummary`, `ChecksFilter`, `PaymentsFilter`, `ChecksKPIs`, `PaymentStatus`, `PaymentMethod`
- [x] 5.3 Verificar que `Dashboard/src/services/billingAPI.ts` (C-12) ya exporta `getCheck(sessionId)` — si no, agregarlo (reutilizado por el modal de detalle)
- [x] 5.4 Verificar que `Dashboard/src/services/receiptAPI.ts` (C-16) exporta `printCheck(checkId)` — reutilizado por el botón "Imprimir recibo"
- [x] 5.5 Tests de `billingAdminAPI.test.ts` con `msw`: ok 200, 403 sucursal ajena, 409 rango >90 días, 429 rate limit

## 6. Frontend — billingAdminStore modular

- [x] 6.1 Crear estructura de carpeta `Dashboard/src/stores/billingAdminStore/` con `store.ts`, `selectors.ts`, `types.ts`, `index.ts`
- [x] 6.2 `types.ts`: definir `BillingAdminState`, `ChecksFilter`, `PaymentsFilter`, y tipos de acciones
- [x] 6.3 `store.ts`: `create<BillingAdminState>()(persist(...))` con state inicial (checks: EMPTY_CHECKS, payments: EMPTY_PAYMENTS, filters con defaults del día), actions `fetchChecks`, `fetchPayments`, `upsertCheck`, `upsertPayment`, `setChecksFilter`, `setPaymentsFilter`, `reset`. El `persist` SOLO persiste `checksFilter` y `paymentsFilter` (usar `partialize`)
- [x] 6.4 Agregar `STORE_VERSIONS.BILLING_ADMIN_STORE = 1` y `STORAGE_KEYS.BILLING_ADMIN_STORE = 'billing-admin'` en `Dashboard/src/utils/constants.ts`
- [x] 6.5 `selectors.ts`: constantes módulo-level `EMPTY_CHECKS`, `EMPTY_PAYMENTS`; hooks `selectChecks`, `selectChecksLoading`, `selectChecksFilter`, `selectChecksKPIs` (con `useMemo`), `selectPayments`, `selectPaymentsLoading`, `selectPaymentsFilter`, `selectPaymentsByMethodSummary` (con `useMemo`, filtra solo APPROVED); hooks de acciones agrupadas con `useShallow` (`useBillingAdminActions()`)
- [x] 6.6 `index.ts`: re-exportar store + selectores
- [x] 6.7 Tests `billingAdminStore.test.ts`: `upsertCheck` reemplaza por id / agrega si no existe; `upsertPayment` idem; filtro persist sobrevive rehidrate; `EMPTY_CHECKS`/`EMPTY_PAYMENTS` retornan misma referencia entre renders; `setChecksFilter` actualiza sólo los campos provistos (spread, no replace)

## 7. Frontend — suscripción WebSocket (BillingRealtimeBridge)

- [x] 7.1 Crear `Dashboard/src/components/billing/BillingRealtimeBridge.tsx` — componente que retorna `null` y maneja la suscripción WS con el ref pattern de dos efectos (ref sync + subscribe once con `[selectedBranchId]` deps)
- [x] 7.2 El handler switchea en `event.type`: `CHECK_REQUESTED`/`CHECK_PAID` → `upsertCheck`; `PAYMENT_APPROVED`/`PAYMENT_REJECTED` → `upsertPayment`. Si el payload está incompleto (según decidido en task 1.4), refetch via `billingAPI.getCheck(sessionId)` o endpoint de detalle de payment
- [x] 7.3 Montar `<BillingRealtimeBridge />` dentro de `Checks.tsx` y `Payments.tsx` (decisión D5 del design — empezar con opción a, luego promover a MainLayout si lo pide HomePage)
- [x] 7.4 Tests `BillingRealtimeBridge.test.tsx`: mock `dashboardWS.onFiltered`; verificar que se suscribe con `selectedBranchId`; al cambiar `branchId` verificar cleanup+resubscribe; simular eventos `CHECK_PAID` y `PAYMENT_APPROVED` y verificar que `upsertCheck`/`upsertPayment` son llamados

## 8. Frontend — página /checks

- [x] 8.1 Crear `Dashboard/src/pages/Checks.tsx` siguiendo el patrón `dashboard-crud-page` (read-only, sin modal de create/edit ni delete — solo detail modal). Incluir `useDocumentTitle`, selectores del store, branch guard con fallback card, `<TableSkeleton>` durante loading, `usePagination`, `useEffect` que llama `fetchChecks` en branch/filter change
- [x] 8.2 Header: DatePicker (selected date en filter) + 3 `<SalesKPICard>` (reutilizar componente existente de Sales) con `selectChecksKPIs` derivado por `useMemo`
- [x] 8.3 Definir `columns: TableColumn<CheckSummary>[]` con useMemo — incluir render de `Badge` para status (Warning `REQUESTED` / Success `PAID`, con `<span className="sr-only">Estado:</span>` prefix), acciones (Ver detalle — abre modal, Imprimir — `receiptAPI.printCheck`), `formatPrice(total_cents)` y `formatPrice(covered_cents)`, `aria-label` en todos los botones de icono
- [x] 8.4 Crear `Dashboard/src/components/billing/CheckStatusBadge.tsx` reutilizable (variant mapping `REQUESTED → warning`, `PAID → success`)
- [x] 8.5 Crear `Dashboard/src/components/billing/CheckDetailModal.tsx` — modal con 3 tablas (Cargos / Asignaciones / Pagos), `<HelpButton size="sm">` como primer elemento, botón "Imprimir recibo" en footer, loading skeleton mientras `billingAPI.getCheck` está pending
- [x] 8.6 Montar `<BillingRealtimeBridge />` en el render de `Checks.tsx`
- [x] 8.7 Tests `Checks.test.tsx`: render sin branch → fallback card; render con branch vacío → `<TableSkeleton>`; render con datos → tabla con badges correctos; click "Ver detalle" → abre modal y llama `billingAPI.getCheck`; click "Imprimir" → llama `receiptAPI.printCheck`; KPIs se calculan desde los datos; KITCHEN es redirigido

## 9. Frontend — página /payments

- [x] 9.1 Crear `Dashboard/src/pages/Payments.tsx` siguiendo el patrón read-only con branch guard, `<TableSkeleton>`, `usePagination`, `useEffect` dependiente de branch + filter
- [x] 9.2 Header: 3 filtros — `DateRangePicker` (o dos DatePickers from/to), `<Select>` de método (`all/cash/card/transfer/mercadopago`), `<Select>` de status (`all/APPROVED/REJECTED/PENDING`). Filters persisten via Zustand `persist`
- [x] 9.3 Columnas: `created_at` (hora), `check_id` (botón que abre `CheckDetailModal`), `method` (con label traducido e icono lucide-react: `Banknote`, `CreditCard`, `ArrowRightLeft`, `Wallet`), `amount_cents` (formatPrice), `status` (badge — `APPROVED` success, `REJECTED`/`FAILED` danger, `PENDING` warning)
- [x] 9.4 Crear `Dashboard/src/components/billing/PaymentMethodSummary.tsx` — tabla compacta al pie con `Método / Cantidad / Total`, consumiendo `selectPaymentsByMethodSummary` (solo APPROVED)
- [x] 9.5 Reutilizar `CheckDetailModal` cuando el usuario clickea un `check_id`
- [x] 9.6 Montar `<BillingRealtimeBridge />` en el render de `Payments.tsx`
- [x] 9.7 Tests `Payments.test.tsx`: filtros aplicados disparan fetch con params correctos; summary excluye REJECTED/PENDING; WAITER redirigido; click check_id abre modal; persist de filters tras rehidrate

## 10. Frontend — navegación y routing

- [x] 10.1 Agregar `BILLING: { groupLabel, checks: 'Cuentas', payments: 'Pagos' }` a los diccionarios i18n en `Dashboard/src/i18n/locales/es.json`, `en.json` (si existe), y claves `layout.breadcrumb.billing.checks`, `layout.breadcrumb.billing.payments`
- [x] 10.2 Modificar `Dashboard/src/components/layout/Sidebar.tsx`: agregar el grupo `Facturación` con 2 items (`Cuentas` → `/checks`, `Pagos` → `/payments`), iconos `Receipt` y `CreditCard` de lucide-react, visible solo si `role === 'ADMIN' || role === 'MANAGER'`
- [x] 10.3 Modificar `Dashboard/src/router.tsx` (o `Dashboard/src/App.tsx` si ahí está la definición): agregar rutas lazy para `/checks` y `/payments`, envolverlas en un `<RoleGuard allow={['ADMIN','MANAGER']}>` (crear este componente si no existe, basado en el `ProtectedRoute` existente), `handle.breadcrumb` apuntando a las claves i18n
- [x] 10.4 Tests `Sidebar.test.tsx`: ADMIN ve Facturación; MANAGER ve Facturación; WAITER no ve; KITCHEN no ve; item activo con `aria-current="page"` al estar en `/checks`
- [x] 10.5 Tests de routing: WAITER navegando a `/checks` → redirigido a `/`; breadcrumb de `/payments` es "Pagos"; lazy load dispara suspense fallback

## 11. Frontend — help content

- [x] 11.1 Agregar entradas `checks` y `payments` en `Dashboard/src/utils/helpContent.tsx` con contenido JSX en español explicando cada KPI, el significado del estado y los filtros
- [x] 11.2 Verificar que ambas páginas pasan `helpContent={helpContent.checks}` / `helpContent={helpContent.payments}` al `PageContainer`
- [x] 11.3 Agregar `<HelpButton size="sm">` inline en el `<CheckDetailModal>` (como primer elemento de la sección de detalle)

## 12. Validación final

- [x] 12.1 Correr tests del backend: `pytest backend/tests/test_admin_billing_service.py backend/tests/test_admin_billing_router.py -v`
- [x] 12.2 Correr tests del Dashboard: `cd Dashboard && npm run test -- billingAdminStore Checks Payments BillingRealtimeBridge Sidebar`
- [x] 12.3 Smoke test manual: login como ADMIN, abrir `/checks` → ver KPIs y listado; abrir modal de detalle → ver 3 tablas; click "Imprimir recibo" → recibo se abre en nueva ventana; abrir `/payments`, filtrar por método "cash" → ver solo cash + summary coherente; disparar un `POST /api/billing/check/request` desde pwaMenu → ver que aparece en `/checks` en tiempo real
- [x] 12.4 Verificar accesibilidad: navegar `/checks` y `/payments` solo con teclado (Tab, Enter, Esc); verificar `aria-label` en botones de icono, `aria-current="page"` en sidebar activa, `role="alert"` en toasts
- [x] 12.5 Correr `npm run lint` y `npm run type-check` en Dashboard; correr `ruff check` y `mypy` en backend — resolver cualquier warning
- [x] 12.6 Checklist de `dashboard-crud-page` aplicable (read-only version): HelpButton presente, Badge con sr-only, TableSkeleton, usePagination, branch guard, aria-labels, toasts en español
- [x] 12.7 Checklist de `zustand-store-pattern`: sin destructuring, useShallow en arrays filtrados, EMPTY_* constantes, version + persist correcto
- [x] 12.8 Checklist de `ws-frontend-subscription`: ref pattern 2 efectos, `[branchId]` como única dep válida, `return unsubscribe`, filtrado por branch via `onFiltered`
- [x] 12.9 Correr `openspec validate dashboard-billing --strict` y resolver cualquier inconsistencia
- [x] 12.10 Actualizar `openspec/CHANGES.md` (si procede) reflejando que C-26 está en apply / done
