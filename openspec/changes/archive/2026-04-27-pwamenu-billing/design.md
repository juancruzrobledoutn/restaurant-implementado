## Context

Este change activa el cierre del loop del comensal en pwaMenu. El backend (C-12) ya tiene:

- `BillingService.request_check()` atómico (set PAYING + crear app_check + charges + Outbox `CHECK_REQUESTED`)
- `PaymentGateway` ABC + `MercadoPagoGateway` (create_preference + verify_webhook)
- Endpoints `/api/billing/check/request`, `/api/billing/check/{id}`, `/api/billing/payment/preference`, `/api/billing/payment/webhook`, `/api/billing/payment/{id}/status` — todos aceptan JWT o Table Token
- Eventos Outbox `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED` enrutados a `send_to_session(session_id)` por ws_gateway (C-09)
- `diner.customer_id` FK dejado "forward-looking" por C-08 para que este change lo active

El frontend pwaMenu (C-17 shell + C-18 ordering) tiene:

- `sessionStore` con `token` (Table Token), `dinerId`, `tableStatus`
- `cartStore` + `roundsStore` con optimistic UI y dedup por `event_id`
- `dinerWS` client con ref pattern, backoff exponencial, catch-up tras reconexión
- `retryQueueStore` persistido en localStorage con FIFO
- `CartBlockedBanner` que se muestra en PAYING

Lo que falta y este change aporta: (a) UI del comensal para solicitar la cuenta y pagar con MP, (b) activación de `Customer` + `diner.customer_id` + opt-in GDPR, (c) propagación WS de eventos financieros al pwaMenu, (d) pantalla de resultado de pago con fallback de polling si MP no retorna.

Governance: **CRITICO** — pagos + datos personales con GDPR. Apply requiere aprobación humana explícita antes de ejecutar; no se ejecuta en autopilot.

## Goals / Non-Goals

### Goals

1. Comensal puede solicitar la cuenta desde pwaMenu con split method (MVP: `equal_split`), UI de `by_consumption` y `custom` planeadas pero detrás de feature flag hasta validación de producto.
2. Comensal puede pagar con Mercado Pago (redirect al Checkout API hosted), sin que pwaMenu toque datos de tarjeta.
3. Comensal recibe confirmación de pago en tiempo real vía WS (`PAYMENT_APPROVED` → `CHECK_PAID`) o vía polling (fallback si WS cae).
4. Al cerrar el check, la sesión transiciona a CLOSED (ya manejado por backend C-12) y el comensal ve confirmación.
5. `device_id` se reutiliza entre visitas: el mismo dispositivo en el mismo tenant resulta en el mismo `customer_id` — base para Phase 2 de loyalty (historial).
6. Opt-in GDPR con consent explícito, versionado, auditable (timestamp + IP hash).
7. Cero PII en logs. Cero datos de tarjeta en logs, DB, cookies, localStorage ni network calls de pwaMenu.

### Non-Goals

- **Retiro de consent (GDPR art. 7(3))** — documentado como gap; queda para change futuro dedicado a DPA.
- **Reversal/chargeback de MP** — si MP revierte un pago después de APPROVED, queda fuera de scope; backend no reconcilia.
- **Phase 3+ loyalty** (recomendaciones ML, puntos, cupones) — este change cubre Phase 1 (device tracking) y Phase 2 (historial + top productos).
- **Split `custom` con montos por comensal** — UI se planifica pero backend ya lo soporta; MVP solo `equal_split`. `by_consumption` queda detrás de feature flag.
- **Tip/propina** — no está en el modelo de datos de C-12. Si se requiere, es otro change.
- **Multi-currency** — todo en pesos (ARS), centavos. MP config por branch si hace falta en el futuro.
- **Pago parcial desde pwaMenu** — un comensal puede pagar su parte (si split es `by_consumption` o `custom`), pero el MVP envía el total del check. Split por comensal queda como evolución.
- **Impresión de ticket térmico** — fuera de scope (responsabilidad de Dashboard o pwaWaiter).
- **Dashboard admin de customer loyalty** — este change solo expone `/api/customer/*` al diner; Dashboard admin queda para change separado.

## Decisions

### D1 — MP Checkout API (redirect) vs Bricks (embedded)

**Decisión**: Usar MP Checkout API con redirect al `init_point`.

**Por qué**:
- **Compliance**: redirect saca a pwaMenu del scope PCI DSS. Con Bricks embeddeado tendríamos que validar el iframe, las CSP y el handling de `card_token` — incluso si MP dice que es seguro, el auditor lo cuenta como "datos de tarjeta pasan por tu DOM".
- **Simplicidad**: un solo redirect + return URL vs lifecycle completo de Bricks (init, errores, estados, cleanup).
- **Fallback**: si MP SDK frontend falla al cargar, el redirect sigue funcionando (solo necesitamos `init_point` URL).
- **Bricks requeriría** `VITE_MP_PUBLIC_KEY` en runtime y evaluación de scripts externos — más superficie de ataque XSS.

**Alternativas consideradas**:
- **Bricks (Payment Brick)**: UX más fluida (no abandona la PWA), pero complica PCI boundary y requiere manejo de tokens en frontend. Rechazado.
- **Wallet Brick (solo escaneo QR MP)**: solo sirve si el usuario tiene app MP instalada. Queda como mejora futura (flag), no reemplaza Checkout API.
- **Backend-only flow (server-to-server)**: requeriría que backend reciba datos de tarjeta, imposible sin PCI DSS Level 1.

**Trade-off aceptado**: el usuario sale de pwaMenu durante el pago. Mitigamos con (a) return URL que vuelve a `/payment/result`, (b) webhook backend que confirma el pago aunque el usuario cierre el browser, (c) polling en `/payment/result` si WS no llegó.

---

### D2 — Activación de `customer_id` en el join público (no en opt-in)

**Decisión**: `POST /api/public/tables/code/{code}/join`, cuando recibe `device_id`, llama `CustomerService.get_or_create_by_device(device_id, tenant_id)` y linkea `diner.customer_id` desde el primer momento. Opt-in es una capa **sobre** el customer existente, no la creación.

**Por qué**:
- El spec de `table-sessions` (C-08) dejó `diner.customer_id` como "forward-looking FK that C-19 will activate" — la expectativa canónica es que C-19 lo active.
- Phase 1-2 de loyalty (tracking implícito + historial) **no requiere** opt-in — son datos internos del negocio, no PII compartida fuera. El device_id es pseudo-anónimo (no identifica persona, solo dispositivo).
- Opt-in agrega PII (name, email) y marca `opted_in = true`. Solo entonces se expone el perfil al usuario en `/profile`.
- Alternativa (crear customer solo en opt-in) rompe la continuidad del historial: si un usuario visita 10 veces sin opt-in y luego acepta, pierde el historial previo. Inaceptable.

**Alternativas consideradas**:
- **Crear customer solo en opt-in**: rompe historial. Rechazado.
- **Crear customer en cada session**: duplicados, sin tracking entre visitas. Rechazado.
- **Soft-create pendiente hasta que tenga rondas**: complica la lógica, mejor crearlo siempre al join.

**Trade-off aceptado**: crecimiento de tabla `customer` proporcional a devices únicos por tenant. Acotado por `UNIQUE(device_id, tenant_id)` y limpieza periódica vía job de mantenimiento (fuera de scope de este change, documentado como gap).

---

### D3 — `tenant_id` como columna en `customer` (antes era global)

**Decisión**: agregar `customer.tenant_id` (FK, not null) y unique partial index en `(device_id, tenant_id) WHERE is_active = TRUE`. Migración backfillea con tenant_id derivado del primer `diner.customer_id` que apunta a él; si no hay diners, el customer es soft-deleted.

**Por qué**:
- Multi-tenant estricto: un device que entra a tenant A y tenant B son dos customers distintos. Sin `tenant_id`, queries del servicio cruzan tenants.
- El spec original de `customer` (knowledge-base 02.10) no menciona tenant, pero todos los demás modelos lo tienen. Fue un descuido corregible.

**Alternativas consideradas**:
- **Customer global sin tenant**: permite que el mismo device sea un solo customer cross-tenant. Útil para franquicias pero rompe el modelo multi-tenant del resto. Rechazado.
- **Customer per-branch**: granularidad excesiva. Un restaurante con 10 branches tendría 10 customers por device. Rechazado.

**Riesgo**: migración sobre tabla preexistente. Este change es el primero que toca `customer` en serio — si la migración anterior ya tiene data con `tenant_id IS NULL`, el ALTER con `NOT NULL` falla. Mitigación: migración de dos pasos (add nullable → backfill → alter not null), en una sola revision Alembic.

---

### D4 — Tres stores separados (billing, payment, customer) vs uno monolítico

**Decisión**: `billingStore`, `paymentStore`, `customerStore` separados. Se comunican por selectores compuestos o por eventos (no por set directo cruzado).

**Por qué**:
- **Single Responsibility**: billing = estado del check; payment = estado del flujo MP; customer = profile + loyalty. Tienen lifecycles distintos (check muere con la sesión; customer persiste entre sesiones).
- **Performance**: un store monolítico re-renderiza todo lo suscrito ante cualquier cambio. Tres stores + `useShallow` en selectores mantiene granularidad.
- **Testeo**: más simple testear cada store aislado. Mocks cruzados son manejables con selectores puros.

**Trade-off**: pequeño overhead en coordinación (ej: cuando `CHECK_PAID` llega, `billingStore` actualiza estado y `sessionStore.tableStatus` pasa a CLOSED). Se resuelve con un subscriber (`billingStore.subscribe(handler)`) sin acoplar stores.

---

### D5 — Polling como fallback post-redirect MP (no reemplazo de WS)

**Decisión**: `PaymentResultPage` suscribe a WS eventos `PAYMENT_*` por defecto. Si pasan 30 segundos sin evento, empieza polling a `GET /api/billing/payment/{id}/status` cada 3s, máximo 20 intentos (60s total). Si timeout, muestra "Tu pago está siendo procesado, revisá en unos minutos" con botón de refresh manual.

**Por qué**:
- **WS puede fallar**: red móvil inestable, service worker dormido, reconexión en curso — el evento `PAYMENT_APPROVED` puede perderse.
- **Outbox garantiza entrega** pero con latencia (proceso outbox corre cada N segundos); si el usuario está mirando la pantalla, necesita feedback inmediato.
- **Backend webhook SIEMPRE confirma**: incluso si WS falla, el status está correcto en DB; polling solo lee DB.
- **Polling es defensivo**: no debe ser el primary path — si lo es, WS está roto y eso es bug de infra (C-24).

**Alternativas consideradas**:
- **Solo WS**: unreliable en móvil. Rechazado.
- **Solo polling**: desperdicia el WS ya construido. Rechazado.
- **Polling más agresivo (1s)**: load innecesario en backend. 3s es balance.

---

### D6 — Rate limiting opt-in a 3/min vs 5/min general de billing

**Decisión**: `POST /api/customer/opt-in` limitado a 3/min per IP. El resto de `/api/customer/*` usa 20/min.

**Por qué**:
- Opt-in acepta datos personales — es un vector de abuse (bots intentando asociar emails a devices, o spam con consent falso).
- 3/min permite un par de reintentos legítimos (usuario corrige email mal tipeado) pero bloquea scraping.
- El resto de `/api/customer/*` es read-only (profile, history) — 20/min es razonable.

**Trade-off**: usuario con tipeos múltiples puede ver 429. Mitigación: validación client-side fuerte del formulario antes de enviar (email regex, required fields).

---

### D7 — Consent audit: IP hash salado por tenant, no plain-text

**Decisión**: al guardar el opt-in, calcular `sha256(client_ip + tenant_salt)` y guardar solo el hash en `customer.consent_ip_hash`. `tenant_salt` es un valor secreto **por tenant**, guardado en `tenant.privacy_salt` (nueva columna, generada con `secrets.token_hex(32)` en la creación de cada tenant).

**Confirmado por el usuario**: salt per-tenant. Motivación: el sistema tiene aislamiento estricto por tenant — un salt global haría que si un salt se compromete, todos los tenants queden expuestos simultáneamente. Con per-tenant, el blast radius queda acotado a un solo tenant. El salt ya está disponible en cualquier request que pase por `tenant_id`, sin complejidad adicional.

**Por qué**:
- **GDPR pide evidencia de consent** (quién, cuándo, desde dónde) pero no pide el IP en plain-text; hash es suficiente para forense.
- **Hash sin salt es reversible** con diccionario de IPv4 (4.3B posibilidades, triviales de rainbow). Salt por tenant hace el lookup costoso.
- **Plain-text IP es PII** bajo GDPR — reduce liability almacenándolo hasheado.

**Trade-off**: investigación forense requiere conocer el salt del tenant + bruteforce si se sospecha de IP específico. Aceptable para un MVP — si llega requerimiento legal, migramos a salt per-record.

**Alternativas consideradas**:
- **Plain IP**: PII exposure. Rechazado.
- **No guardar IP**: pierde forense. Rechazado.
- **Salt global (env var)**: menor aislamiento, mayor blast radius si se compromete. Rechazado.
- **Salt per-record (bcrypt)**: costoso de verificar. Overkill para este use case.

---

### D8 — `paymentStore.phase` FSM explícita vs flags booleanos

**Decisión**: FSM explícita con transiciones validadas:

```
idle → creating_preference → redirecting → pending → approved | rejected | failed
                                       ↑                          │
                                       └──── polling_timeout ─────┘
```

Helper `transition(from, to)` valida transiciones; logs WARN y no cambia estado si es inválida.

**Por qué**:
- Flags booleanos (`isLoading`, `isPaying`, `isError`) llevan a estados imposibles (`isLoading && isError` simultáneos, bug común en C-17).
- FSM hace el estado **testable de forma exhaustiva** (cada transición es un test unitario).
- Previene race conditions: si llega `PAYMENT_APPROVED` en estado `idle` (evento fantasma), se ignora en vez de mutar.

---

### D9 — WS events coordination entre stores

**Decisión**: handler central en `dinerWS` que dispatchea a los stores correspondientes:

- `CHECK_REQUESTED` → `billingStore.setCheck(...)`, `sessionStore.setTableStatus('PAYING')`, `cartStore.setBlocked(true)` (este último ya existe en C-18)
- `CHECK_PAID` → `billingStore.setStatus('PAID')`, `sessionStore.setTableStatus('CLOSED')`, navegación a pantalla de confirmación
- `PAYMENT_APPROVED` → `paymentStore.transition('pending', 'approved')`
- `PAYMENT_REJECTED` → `paymentStore.transition('pending', 'rejected')`

El handler **no vive en un store** — vive en `useBillingWS()` hook que se monta una sola vez en `App.tsx`. Cada store expone setters/actions idempotentes.

**Por qué**:
- Si cada store se suscribe a WS independientemente, duplicamos parsing y arriesgamos desincronización.
- Hook central = un solo punto de verdad para el routing de eventos → stores.
- Stores quedan "tontos" (puro estado + setters) — testables sin mockear WS.

---

## Risks / Trade-offs

- **[Riesgo] Usuario cierra pwaMenu durante redirect a MP y nunca vuelve** → webhook backend confirma el pago; al próximo `join` del mismo device, ve el check en estado PAID en historial. Si el mismo `session_id` está aún activo, `GET /api/billing/check/{session_id}` retorna el estado actual. Mitigación completa.

- **[Riesgo] Doble click en "Pagar con MP" crea dos preferences** → `paymentStore.phase = 'creating_preference'` bloquea el botón durante la llamada. Debounce de 500ms adicional. Backend debería idempotenciar `POST /api/billing/payment/preference` por `(check_id, client_idempotency_key)` — si no lo hace, documentar como gap para C-24.

- **[Riesgo] WS cae justo cuando llega `PAYMENT_APPROVED`** → polling fallback (D5) cubre este caso. Outbox garantiza que el evento eventualmente se publica; si ws_gateway está caído, polling lee DB.

- **[Riesgo] Customer creado sin opt-in es PII?** → No. `device_id` es un hash random generado cliente-side, sin correlación con persona física identificable (no es IP, no es fingerprint del browser). Phase 1 es pseudo-anónimo por diseño. Documentar en `knowledge-base/03-seguridad/`.

- **[Riesgo] Feature flag de split methods queda en TODO** → MVP solo `equal_split`. `by_consumption` y `custom` requieren UI compleja (selector de items por comensal) — se documentan como fuera de scope y se deja el backend preparado. Frontend envía siempre `equal_split` en este change.

- **[Riesgo] Browser autocomplete filtra email en campos de opt-in** → aceptable (el usuario lo aceptó). Usar `autocomplete="email"` para UX, y `autocomplete="off"` solo en el checkbox de consent (el consent es explícito por click).

- **[Riesgo] Usuario no ve la confirmación porque service worker sirve versión vieja** → `CheckStatusPage` fuerza `network-first` en su data fetch (no cacheable). Service worker solo cachea shell y assets, no endpoints de billing.

- **[Riesgo] i18n de textos legales (consent) requiere revisión legal por idioma** → flaggear en tasks. El texto legal en `opt-in.consent` de `es/en/pt` DEBE ser revisado por humano antes del apply. Documentar que el draft de i18n es placeholder.

- **[Riesgo] MP webhook no verifica signature** → bug de C-12; este change NO arregla C-12. Si el test de regresión falla, crear ticket a C-24 y NO proceder con apply.

- **[Trade-off] No split por comensal en MVP** → la mayoría de restaurantes usan `equal_split` o cobro consolidado. Validamos con producto antes de invertir en UI compleja.

- **[Trade-off] Customer multi-tenant estricto duplica registros para franquicias** → aceptable en MVP. Franquicias son un caso edge futuro que requiere modelo de "parent tenant", fuera de scope.

## Migration Plan

### Pasos de deployment

1. **Pre-deploy**: verificar que `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET` están configurados en el `.env` de producción (legado de C-12). Si falta alguno, NO deployar.
2. **Backend — migration Alembic**:
   - Step 1: `ALTER TABLE tenant ADD COLUMN privacy_salt VARCHAR(64) NULL` + backfill con `secrets.token_hex(32)` para tenants existentes + `ALTER COLUMN privacy_salt SET NOT NULL`
   - Step 2: `ALTER TABLE customer ADD COLUMN tenant_id BIGINT NULL` + FK (nullable para backfill)
   - Step 3: backfill `customer.tenant_id` desde `diner.customer_id` → `diner.tenant_id` (si hay data); si customer huérfano, set `is_active = FALSE`
   - Step 4: `ALTER TABLE customer ALTER COLUMN tenant_id SET NOT NULL` + unique partial index `(device_id, tenant_id) WHERE is_active`
   - Step 5: `ALTER TABLE customer ADD COLUMN consent_version VARCHAR(20), consent_granted_at TIMESTAMPTZ, consent_ip_hash VARCHAR(64), opted_in BOOLEAN NOT NULL DEFAULT FALSE`
   - Todo en **una sola revision** Alembic (atomic).
3. **Backend — deploy rest_api**: nuevos endpoints `/api/customer/*` disponibles. Router incluido en `main.py`. Verificar que `POST /api/public/tables/code/{code}/join` linkea `customer_id` (feature flag `ENABLE_CUSTOMER_TRACKING=true` por defecto).
4. **Frontend — pwaMenu**: build con `VITE_MP_PUBLIC_KEY` y `VITE_MP_RETURN_URL`. Verificar que no se filtraron en el bundle (greppear el bundle `assets/*.js` post-build).
5. **Smoke test producción (staging first)**:
   - Join con `device_id` → customer creado, linkeado en diner
   - Request check desde pwaMenu → PAYING + charges correctos + WS evento llega
   - Click "Pagar MP" → redirect a init_point MP (sandbox)
   - Vuelve a `/payment/result` → muestra APPROVED (evento WS o polling)
   - Check = PAID, session = CLOSED
   - Opt-in con email válido → customer.opted_in = true, consent_granted_at no null
6. **Rollback**:
   - Si bugs críticos en frontend: revertir build pwaMenu al previo (feature flag off en router). Backend sigue funcionando — solo no se llama desde frontend.
   - Si bugs en backend endpoints `/api/customer/*`: remover router en `main.py` (hotfix); migración queda, no rompe nada.
   - Si bug en activación de `customer_id` en join: feature flag `ENABLE_CUSTOMER_TRACKING=false`. Nuevos diners crearán con `customer_id = NULL` — comportamiento pre-C-19.
   - Migración es **forward-only** (GDPR: no borrar consent records). Si hay que revertir columnas, crear nueva migration que las marque como legacy.

## Open Questions

1. ~~**`tenant.consent_salt`**~~ — **RESUELTO**: `tenant.privacy_salt` columna per-tenant, generada con `secrets.token_hex(32)` en creación. Migración agrega la columna + backfill para tenants existentes.
2. ~~**Retirement de consent**~~ — **RESUELTO**: fuera de scope de C-19. Queda documentado como gap para change futuro dedicado a DPA/GDPR compliance.
3. ~~**`VITE_MP_PUBLIC_KEY` por branch o por tenant?**~~ — **RESUELTO**: una key por tenant (env var `VITE_MP_PUBLIC_KEY` en MVP). Si una branch requiere cuenta MP propia en el futuro, es un nuevo change con endpoint dinámico.
4. **Feature flags**: ¿usamos `ENABLE_CUSTOMER_TRACKING`, `ENABLE_SPLIT_BY_CONSUMPTION`, `ENABLE_SPLIT_CUSTOM` como env vars o como feature flag service (Unleash, LaunchDarkly)? Propongo env vars simples en MVP — sin dependencia externa.
5. ~~**Textos legales de consent en i18n**~~ — **RESUELTO**: implementar con placeholders marcados `[LEGAL REVIEW REQUIRED]` en los tres idiomas (es/en/pt). Ningún CI ni deploy a prod puede pasar si el marcador está presente — agregar grep check en build/smoke. El texto final lo provee revisión legal antes del deploy.
6. **Máximo retry count en polling post-MP return** — propongo 20 intentos (60s). El usuario puede bajarlo a 10 (30s) si UX lo pide. Abierto a ajuste en apply.
