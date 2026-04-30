## Why

C-18 (pwamenu-ordering) cerró el loop de pedido del comensal hasta la entrega (READY → SERVED). C-12 (billing) dejó listo todo el backend de facturación (Check/Charge/Allocation/Payment, `BillingService.request_check()`, `MercadoPagoGateway`, endpoints `POST /api/billing/check/request` y `POST /api/billing/payment/preference` aceptando Table Token, eventos Outbox financieros). Sin embargo, **pwaMenu no tiene UI para pedir la cuenta ni para pagar** — el comensal queda varado después de comer sin forma de cerrar la experiencia desde su teléfono. Este change habilita el cierre end-to-end del ciclo del comensal: solicitar la cuenta con split, elegir pagar con Mercado Pago, recibir confirmación en tiempo real (APPROVED/REJECTED) y ver la sesión cerrarse automáticamente. En paralelo activa la **Fase 1-2 de fidelización de clientes** (device tracking + historial de visitas + opt-in GDPR) — el FK `customer_id` en `diner` ya está en el esquema esperando ser usado (ver spec `table-sessions`, línea 30: "forward-looking FK that C-19 will activate").

## What Changes

### Backend — activación Fase 1-2 de Customer Loyalty + GDPR

- **NUEVO servicio de dominio `CustomerService`** en `backend/rest_api/services/customer_service.py`: `get_or_create_by_device(device_id, tenant_id)`, `get_profile(customer_id)`, `opt_in(customer_id, name, email, consent_timestamp)`, `get_visit_history(customer_id, branch_id?)`. Heredando de `BaseCRUDService[Customer, CustomerOut]`.
- **NUEVO router `/api/customer/` con X-Table-Token** en `backend/rest_api/routers/customer.py`: `GET /profile` (perfil por `device_id` del session), `POST /opt-in` (consentimiento GDPR explícito: name, email, timestamp de aceptación, IP, user-agent hasheado), `GET /history` (últimas 20 visitas del device), `GET /preferences` (agregado de productos pedidos, top 5).
- **Migración Alembic**: `customer.consent_version` (String 20, nullable), `customer.consent_granted_at` (DateTime, nullable), `customer.consent_ip_hash` (String 64, nullable), `customer.opted_in` (Boolean, default False); agregar `tenant_id` FK a `customer` (multi-tenant obligatorio); unique partial index en `(device_id, tenant_id) WHERE is_active = TRUE`.
- **Activación de `diner.customer_id`**: el endpoint público `POST /api/public/tables/code/{code}/join` SHALL, cuando recibe `device_id`, llamar a `CustomerService.get_or_create_by_device()` y linkear `diner.customer_id` con el resultado. Sin `device_id` → `customer_id = NULL` (comensal anónimo, comportamiento actual).
- **Rate limiting**: `POST /api/customer/opt-in` 3/minuto por IP (dato sensible GDPR); `GET /api/customer/*` 20/minuto.
- **Webhook IPN (ya existe en C-12)** — verificar que emite `PAYMENT_APPROVED` / `PAYMENT_REJECTED` / `CHECK_PAID` vía Outbox; si hay gaps, patchear en este change (sin re-implementar).

### Frontend — pwaMenu (puerto 5176)

- **NUEVO `billingStore` (Zustand 5)**: estado del check actual (`checkId`, `status: 'NONE' | 'REQUESTED' | 'PAID'`, `charges`, `payments`, `remainingCents`, `splitMethod`), selectores puros (`selectCheck`, `selectRemaining`, `selectCanPay`) con `useShallow`, `EMPTY_ARRAY` estable. Rehidratación vía `GET /api/billing/check/{session_id}` al montar.
- **NUEVO `paymentStore` (Zustand 5)**: estado del flujo MP (`phase: 'idle' | 'creating_preference' | 'redirecting' | 'pending' | 'approved' | 'rejected' | 'failed'`, `preferenceId`, `initPoint`, `paymentId`, `errorCode`), transiciones explícitas, reset al cerrar sesión.
- **NUEVO `customerStore` (Zustand 5)**: `profile` (nullable), `visitHistory`, `preferences` (top productos), `optedIn: boolean`, `consentVersion`. Carga lazy al entrar a `/profile`. Nunca persistimos datos personales en `localStorage` — solo en memoria durante la sesión.
- **Integración MP SDK Checkout API** (no Bricks, no Web SDK full — solo redirect): `VITE_MP_PUBLIC_KEY` leída de env (no commiteada), `pwaMenu/src/services/mercadoPago.ts` que llama a `POST /api/billing/payment/preference` y redirige a `init_point`. **Ningún dato de tarjeta toca pwaMenu** — se queda fuera del scope PCI.
- **NUEVA página `CheckRequestPage` (`/check/request`)**: selector de split method (`equal_split` | `by_consumption` | `custom` — UI de custom solo UI, MVP envía `equal_split`), summary de cargos por comensal, botón "Solicitar cuenta" que llama `POST /api/billing/check/request` con X-Table-Token. Llega 201 → transiciona a `CheckStatusPage`.
- **NUEVA página `CheckStatusPage` (`/check`)**: muestra estado del check, cargos desglosados, CTA "Pagar con Mercado Pago". Reactiva a WS: suscribe `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`; cuando `CHECK_PAID` → mostrar ticket + CTA "Volver al menú" (opt-in) + CTA "Dejar opinión" (futuro, solo placeholder).
- **NUEVA página `PaymentResultPage` (`/payment/result`)**: return URL de MP con query params (`status`, `payment_id`, `preference_id`). Mapea a `paymentStore.phase`, muestra spinner mientras espera evento WS confirmatorio, timeout a 30s con retry (polling `GET /api/billing/payment/{id}/status`).
- **NUEVA página `ProfilePage` (`/profile`)**: accesible desde BottomNav si `customerStore.profile !== null`. Muestra historial de visitas y top 5 productos. Si `opted_in = false`, muestra CTA "Quiero recibir beneficios" que abre `OptInForm`.
- **NUEVO componente `OptInForm` (React 19 `useActionState`)**: captura name, email, acepta consent explícito (checkbox NO pre-tildado, texto legal i18n). Envía `POST /api/customer/opt-in`. Validación de email con regex simple + server-side authoritative.
- **Integración con `cartStore` y `sessionStore` (MODIFICACIÓN)**: cuando `CHECK_REQUESTED` llega vía WS o el comensal dispara `POST /api/billing/check/request`, `sessionStore.tableStatus` pasa a `PAYING` y `cartStore` bloquea nuevas adiciones (ya soportado en C-18 vía `CartBlockedBanner`, aquí se coordina el disparo).
- **Cliente WS — nuevos handlers**: extender `pwaMenu/src/services/ws/dinerWS.ts` (ya creado en C-18) con handlers para `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`. Idempotencia por `event_id` ya está resuelta en C-18, solo agregar routing.
- **i18n es/en/pt**: ~60 keys nuevas en `check`, `payment`, `customer`, `consent`, `errors.billing`. Cero strings hardcodeadas.
- **Retry queue (ya en C-18)**: encolar `billing.requestCheck` y `billing.createPreference` cuando fallan por red; **NO encolar el retorno de MP** (es irrecuperable si el usuario cerró el browser — se confirma por webhook backend).

### Security Considerations (CRITICO)

Esta sección es obligatoria por ser governance CRITICO. El apply NO puede empezar sin revisión humana de estos puntos:

1. **PCI compliance boundary**: pwaMenu **NUNCA** toca datos de tarjeta. Usamos MP Checkout API con redirect al `init_point` — MP hostea la página de pago, nosotros solo guardamos `preferenceId` y leemos `payment.external_id` del webhook. Queda fuera de PCI DSS scope.
2. **Webhook signature verification**: el endpoint `POST /api/billing/payment/webhook` (ya implementado en C-12) DEBE verificar HMAC de `MERCADOPAGO_WEBHOOK_SECRET`. Este change NO toca la ruta del webhook — si hay gaps, se corrigen en C-24 code-review-fixes, no acá.
3. **Table Token scope**: `POST /api/billing/check/request` y `POST /api/billing/payment/preference` validan que el Table Token corresponde a la `session_id` del request. Esto ya está cubierto por `verify_table_token()` en C-12. Este change lo consume, no lo modifica.
4. **GDPR consent (opt-in)**: el formulario `OptInForm` SHALL registrar: `consent_version` (versión del texto legal vigente), `consent_granted_at` (timestamp server-side), `consent_ip_hash` (SHA-256 del IP con salt por tenant, no plain-text). Retiro del consent (`DELETE /api/customer/opt-in`) queda para C-26 o posterior (fuera de scope).
5. **Rate limiting dedicado**: endpoints `/api/customer/opt-in` limitados a 3/min per IP para frenar scraping/abuse. Aparte de los 5/min ya existentes en billing.
6. **Logs sin PII**: ningún log SHALL contener email, name, ni device_id en plain-text. Usar `get_logger()` y hash/mask en los campos sensibles. **Human review obligatorio sobre todos los logs que este change introduzca**.
7. **Return URL de MP**: `VITE_MP_RETURN_URL=https://{branch_slug}.{domain}/payment/result` — `branch_slug` se incluye pero NO el `session_id` (se leyó al montar). Evitar URL con secretos.
8. **WS subscription scope**: `CHECK_PAID` y `PAYMENT_*` se emiten solo a `send_to_session(session_id)` — no a otros comensales fuera de la mesa. Esto ya lo garantiza C-09, este change lo consume.
9. **Double-spend defense**: si un segundo pago para el mismo `check` llega cuando ya está PAID, backend SHALL retornar 409 y NO crear un segundo Payment. Ya cubierto en C-12; validar con test de regresión en este change.

**Flag de revisión humana obligatoria** (por governance CRITICO — no autónomo):
- Tasks del grupo `backend-services` (CustomerService + opt-in endpoint) — requieren review manual antes del merge
- Tasks del grupo `frontend-payment` (integración MP + return URL) — requieren review manual
- Migración Alembic (`customer` extensions + FK activation) — requiere review de DBA antes de `alembic upgrade head`

## Capabilities

### New Capabilities

- `pwamenu-billing`: experiencia de facturación y pago del comensal en pwaMenu. Cubre solicitud de cuenta desde el cliente (`POST /api/billing/check/request` con split method), integración frontend con Mercado Pago Checkout API (redirect-only, sin PCI scope), reactividad WebSocket a eventos financieros (`CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`), página de estado del check, página de resultado de pago con fallback de polling, y la integración con el bloqueo de nuevos pedidos cuando la mesa está en PAYING.
- `customer-loyalty`: fundaciones de fidelización de clientes — Fase 1 (device tracking vía `device_id` heredado del QR join) y Fase 2 (historial de visitas agregado + preferencias implícitas basadas en rondas previas). Incluye el servicio de dominio `CustomerService`, el router `/api/customer/` autenticado con Table Token, el flow de opt-in GDPR con consent explícito y versionado, y la activación del FK `diner.customer_id`. **No incluye** Phase 3+ (recomendaciones ML) ni programas de puntos — eso queda para changes futuros.

### Modified Capabilities

- `table-sessions`: el endpoint `POST /api/public/tables/code/{code}/join` SHALL linkear `diner.customer_id` llamando a `CustomerService.get_or_create_by_device()` cuando recibe `device_id`. La spec actual (línea 30) menciona `customer_id` como "forward-looking FK that C-19 will activate" — este change cumple esa promesa. Sin `device_id`, comportamiento sin cambios.
- `pwamenu-ordering`: el `cartStore` y la UI del carrito (ya creados en C-18) SHALL reaccionar al evento `CHECK_REQUESTED` bloqueando la adición de nuevos items (UI defensiva — backend ya rechaza con 409). El `CartBlockedBanner` ya existente (C-18) muestra el mismo mensaje en PAYING. Este change **no altera requisitos existentes**, solo agrega la propagación del evento desde el lado del comensal que solicita la cuenta (antes solo lo disparaba el mozo o backend externo).

## Impact

- **Backend — `backend/rest_api/`**:
  - `models/customer.py` — extender con `consent_version`, `consent_granted_at`, `consent_ip_hash`, `opted_in`, `tenant_id` FK
  - `services/customer_service.py` — NUEVO
  - `schemas/customer.py` — `CustomerOut`, `CustomerProfileOut`, `OptInIn`, `VisitOut`
  - `routers/customer.py` — NUEVO (`/api/customer/*` con Table Token)
  - `routers/public.py` — MODIFICAR `POST /api/public/tables/code/{code}/join` para linkear `customer_id`
  - `services/permissions/strategies.py` — agregar `DinerPermissionContext` si no existía (revisar C-17/C-18)
  - Alembic migration nueva (número a definir por el autogenerate — previsible 014 o siguiente)
- **Frontend — `pwaMenu/`**:
  - `src/stores/billingStore.ts`, `paymentStore.ts`, `customerStore.ts` — NUEVOS
  - `src/services/billingApi.ts`, `customerApi.ts`, `mercadoPago.ts` — NUEVOS
  - `src/pages/{CheckRequestPage,CheckStatusPage,PaymentResultPage,ProfilePage}.tsx` — NUEVAS
  - `src/components/billing/{CheckSummary,ChargeRow,PaymentButton,PaymentStatus,ConsentBlock,OptInForm}.tsx` — NUEVOS
  - `src/services/ws/dinerWS.ts` — EXTENDER con handlers `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_*`
  - `src/hooks/useBillingWS.ts` — NUEVO (subscriber thin)
  - `src/i18n/locales/{es,en,pt}.json` — ~60 keys nuevas
  - `src/types/{billing,payment,customer}.ts` — tipos compartidos
  - `src/App.tsx` — registrar rutas `/check`, `/check/request`, `/payment/result`, `/profile`
  - `src/tests/` — tests de billingStore, paymentStore, customerStore, OptInForm, MP flow mockeado
- **Infraestructura**:
  - `.env.example` — agregar `VITE_MP_PUBLIC_KEY=APP_USR-...`, `VITE_MP_RETURN_URL=http://localhost:5176/payment/result`
  - `devOps/docker-compose.yml` — propagar `VITE_MP_PUBLIC_KEY` al build de pwaMenu si no lo hace ya
- **Eventos consumidos desde ws_gateway** (todos vía Outbox, ya emitidos por C-12):
  - `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`
- **Dependencias (ya archivadas)**:
  - C-12 `billing` — backend completo de billing (Check, Charge, Allocation, Payment, BillingService, MP gateway, endpoints)
  - C-18 `pwamenu-ordering` — `sessionStore`, `cartStore`, `dinerWS`, `retryQueueStore`, i18n base
  - C-08 `table-sessions` — Table Token, `POST /api/public/tables/code/{code}/join`, `diner.customer_id` FK placeholder
  - C-09 `ws-gateway-base` — routing de eventos por sesión (`send_to_session`)
- **Riesgos**:
  - **Browser cierra durante redirect MP** → mitigación: webhook IPN backend confirma el pago aunque el cliente no vuelva; al reabrir pwaMenu con el mismo Table Token, `billingStore` rehidrata vía `GET /api/billing/check/{session_id}` y detecta `CHECK_PAID`.
  - **`device_id` duplicado entre tenants** → mitigación: unique constraint en `(device_id, tenant_id)` — el mismo device puede ser customer en múltiples tenants sin colisión.
  - **Consent retirement no implementado en este change** → mitigación: documentar en `knowledge-base/03-seguridad/` que C-19 solo cubre opt-in; retiro queda para change futuro con GDPR DPA completa.
  - **MP rejecta el pago después de APPROVED (reversal)** → fuera de scope. Se documenta como gap conocido para resolver en change dedicado a reconciliación.
  - **Sincronización de `customerStore` entre múltiples comensales de la misma mesa** → cada comensal tiene su propio `device_id` y su propio `customer`; no se sincronizan entre sí. No hay shared state de loyalty a nivel mesa.
  - **PII en logs** → mitigación: code review obligatorio sobre todos los `get_logger().*` calls; test que grep los logs en CI y falla si hay emails/nombres en plain-text.
  - **Rate limit demasiado agresivo en opt-in bloquea casos legítimos** → mitigación: 3/min per IP es conservador pero alineado con billing critical endpoints; métricas observables post-deploy para ajustar si hay falsos positivos.
