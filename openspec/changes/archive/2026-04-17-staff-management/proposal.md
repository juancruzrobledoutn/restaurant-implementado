## Why

El sistema necesita que ADMIN y MANAGER puedan gestionar el personal (altas, bajas, roles M:N por branch) y las promociones por sucursal, y que los mozos (WAITER) puedan operar desde pwaWaiter verificando su asignación diaria y recibiendo push notifications cuando ocurren eventos críticos (ronda lista, llamado de servicio, cuenta solicitada). Además, este change es el primer punto del roadmap donde aparecen eventos con garantía de entrega transaccional (ROUND_SUBMITTED, SERVICE_CALL_CREATED, CHECK_REQUESTED, etc.), por lo que se introduce la infraestructura de **Outbox Pattern** que será consumida por C-10 (rounds), C-11 (kitchen) y C-12 (billing).

Este change es **C-13 staff-management** en `openspec/CHANGES.md`, depende de C-08 table-sessions (archivado) y es el paralelo del fork que se abre tras GATE 6 junto con C-09 ws-gateway-base y C-17 pwaMenu-shell. Governance: **ALTO** (toca Staff, que es CRITICO, pero el alcance funcional de este change es ALTO — CRUD con permisos correctos).

## What Changes

- **Nueva infraestructura de eventos (Outbox Pattern)**:
  - Nuevo modelo `OutboxEvent` (tabla `outbox_event`) con columnas `id`, `event_type`, `payload` (JSONB), `created_at`, `processed_at` (nullable).
  - Nuevo `OutboxService` con método `write_event(event_type, payload, db)` que inserta en la misma transacción de negocio — no hace commit.
  - Documentación del contrato para que C-10, C-11 y C-12 lo consuman.
  - **Nota**: este change NO implementa el background processor que publica a Redis Streams — eso queda para C-09 ws-gateway-base o C-10 según cuál llegue primero. Este change solo agrega el modelo, la tabla y el helper de escritura.

- **Gestión de Staff (usuarios + roles)**:
  - Nuevo `StaffService` extendiendo `BranchScopedService` con métodos `create_user`, `update_user`, `soft_delete_user`, `list_users_for_branch`, `assign_role_to_branch`, `revoke_role_from_branch`, `list_assignments_today`, `assign_waiter_to_sector_daily`.
  - Endpoints admin `/api/admin/staff`: `GET`, `POST`, `PATCH /{id}`, `DELETE /{id}`, `POST /{id}/branches` (asigna rol en un branch), `DELETE /{id}/branches/{branch_id}` (revoca rol).
  - Endpoints admin para asignación diaria de mozos: `GET /api/admin/waiter-assignments?date=YYYY-MM-DD&sector_id=X`, `POST /api/admin/waiter-assignments` (crea asignación), `DELETE /api/admin/waiter-assignments/{id}`.
  - Reglas de permisos: ADMIN → todo; MANAGER → crear/editar staff en sus branches (sin delete); KITCHEN/WAITER → sin acceso.

- **Gestión de Promotions**:
  - 3 nuevos modelos: `Promotion` (tenant-scoped), `PromotionBranch` (junction M:N con `branch`), `PromotionItem` (junction M:N con `product`).
  - Nuevo `PromotionService` con CRUD + `link_branch(promotion_id, branch_id)` y `link_product(promotion_id, product_id)`.
  - Endpoints admin `/api/admin/promotions`: CRUD completo + `POST /{id}/branches`, `POST /{id}/products`, `DELETE` correspondientes.
  - Validación de vigencia temporal (`start_date`/`start_time` ≤ `end_date`/`end_time`).
  - Precios en centavos (int). `promotion.price` es el precio promocional consolidado (no suma de items).

- **Verificación de asignación diaria del mozo (pwaWaiter pre-login)**:
  - Nuevo endpoint `GET /api/waiter/verify-branch-assignment?branch_id={id}` (JWT WAITER): devuelve `{ assigned: true, sector_id: X, sector_name: "..." }` si el mozo tiene una `WaiterSectorAssignment` para hoy en un sector de ese branch; `{ assigned: false }` en caso contrario (HTTP 200 en ambos casos para evitar leaks de info).
  - **Nota de reuso**: el modelo `WaiterSectorAssignment` y el CRUD base de asignaciones ya existen desde C-07 sectors-tables. Este change agrega **solo** el endpoint de verificación desde el lado del mozo y los endpoints admin de alto nivel (que operan sobre el mismo modelo).

- **Push Notifications para pwaWaiter**:
  - Nuevo modelo `PushSubscription` (tabla `push_subscription`) con columnas `id`, `user_id` (FK app_user), `endpoint` (String 500, unique), `p256dh_key` (String 255), `auth_key` (String 255), `created_at`, `is_active`.
  - Nuevo `PushNotificationService` con `subscribe(user_id, endpoint, p256dh_key, auth_key)`, `unsubscribe(user_id, endpoint)`, `send_to_user(user_id, title, body, url)` usando `pywebpush`.
  - Endpoint `POST /api/waiter/notifications/subscribe` (JWT WAITER) — registra suscripción VAPID idempotente (upsert por endpoint).
  - Endpoint `DELETE /api/waiter/notifications/subscribe?endpoint=X` — elimina suscripción.
  - Variables de entorno nuevas: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`.
  - **Nota**: este change agrega el lado server de la suscripción. El consumo real (disparar push en eventos de ronda/servicio) queda para C-10/C-11/C-12 — aquí solo se expone el service para que lo inyecten.

- **Migración 010**: crea tablas `outbox_event`, `promotion`, `promotion_branch`, `promotion_item`, `push_subscription`. Los modelos de Staff (User, UserBranchRole) ya existen desde C-02.

- **Seed mínimo** (opcional, si hay tiempo): 1 promotion demo vinculada al branch seed de C-02, 1 waiter_sector_assignment para `waiter@demo.com` con fecha de HOY.

- **Tests**:
  - `test_staff_service.py`: CRUD usuarios, asignación de roles M:N, permisos ADMIN vs MANAGER, no-delete de MANAGER.
  - `test_waiter_assignments.py`: crear/listar/borrar asignaciones, unique constraint (user+sector+date).
  - `test_verify_branch_assignment.py`: assigned=true/false según fecha de HOY, múltiples branches.
  - `test_promotion_service.py`: CRUD, vinculación con branches/products, vigencia temporal.
  - `test_push_subscription.py`: upsert idempotente, unsubscribe, aislamiento por usuario.
  - `test_outbox_service.py`: write_event atómico con la transacción de negocio, rollback si falla.

## Capabilities

### New Capabilities

- `staff-management`: CRUD de usuarios, asignación M:N de roles por branch, soft delete, permisos ADMIN/MANAGER diferenciados.
- `waiter-assignments`: asignación diaria de mozos a sectores, endpoints admin para gestionar y endpoint público (JWT WAITER) para verificación pre-login en pwaWaiter.
- `promotions`: CRUD de promociones tenant-scoped, vinculación M:N con branches y productos, vigencia temporal, precios consolidados en centavos.
- `push-notifications`: suscripción VAPID para pwaWaiter, modelo `PushSubscription`, service que envía notificaciones a usuarios específicos (consumido por changes posteriores).
- `outbox-pattern`: modelo `OutboxEvent` + `OutboxService.write_event` para escrituras atómicas dentro de transacciones de negocio. Base de infraestructura consumida por C-10/C-11/C-12.

### Modified Capabilities

- `sectors-tables`: se agrega el endpoint `GET /api/waiter/verify-branch-assignment` que consulta `WaiterSectorAssignment` (modelo creado en C-07). El modelo no cambia, solo se agrega un caso de uso nuevo sobre él. Se documenta en un delta spec.

## Impact

### Código nuevo
- `backend/rest_api/models/outbox.py` — modelo `OutboxEvent`.
- `backend/rest_api/models/promotion.py` — modelos `Promotion`, `PromotionBranch`, `PromotionItem`.
- `backend/rest_api/models/push_subscription.py` — modelo `PushSubscription`.
- `backend/rest_api/services/outbox_service.py` — `OutboxService.write_event`.
- `backend/rest_api/services/staff_service.py` — `StaffService` extendiendo `BranchScopedService`.
- `backend/rest_api/services/promotion_service.py` — `PromotionService`.
- `backend/rest_api/services/push_notification_service.py` — `PushNotificationService` con `pywebpush`.
- `backend/rest_api/services/waiter_assignment_service.py` — lógica del endpoint `verify-branch-assignment` y operaciones admin.
- `backend/rest_api/routers/admin/staff.py` — endpoints admin de staff.
- `backend/rest_api/routers/admin/promotions.py` — endpoints admin de promotions.
- `backend/rest_api/routers/admin/waiter_assignments.py` — endpoints admin de asignaciones.
- `backend/rest_api/routers/waiter/notifications.py` — suscripción push desde pwaWaiter.
- `backend/rest_api/routers/waiter/assignments.py` — endpoint `verify-branch-assignment`.
- `backend/rest_api/schemas/staff.py`, `schemas/promotion.py`, `schemas/push_subscription.py`, `schemas/outbox.py`.
- `backend/alembic/versions/010_staff_management.py` — migración con todas las tablas nuevas.

### Tests nuevos
- `backend/tests/test_staff_service.py`
- `backend/tests/test_waiter_assignments.py`
- `backend/tests/test_verify_branch_assignment.py`
- `backend/tests/test_promotion_service.py`
- `backend/tests/test_push_subscription.py`
- `backend/tests/test_outbox_service.py`

### Dependencias nuevas
- `pywebpush` (Python) — envío de web push notifications con VAPID.
- `py-vapid` (transitiva de `pywebpush`) — generación/validación de claims VAPID.

### Variables de entorno nuevas
- `VAPID_PUBLIC_KEY` — clave pública VAPID (base64 URL-safe).
- `VAPID_PRIVATE_KEY` — clave privada VAPID (archivo o base64).
- `VAPID_CONTACT_EMAIL` — email de contacto obligatorio en el JWT VAPID.

### No afectado en este change
- El background worker del outbox (procesador que lee `outbox_event` y publica a Redis Streams) se implementa en C-09 o C-10 según el camino crítico. Este change solo provee el modelo y el helper `write_event`.
- El consumo del `PushNotificationService` desde eventos de negocio (rondas, service calls, checks) se implementa en C-10/C-11/C-12. Este change solo provee el service.
- Los frontends (Dashboard C-16, pwaWaiter C-20) consumen estos endpoints en sus changes propios.

### Governance & seguridad
- Dominio **Staff** está catalogado como CRITICO en la matriz de governance; este change toca CRUD de usuarios pero **no** altera auth ni contraseñas (eso está en C-03 auth). Por eso el governance efectivo es **ALTO**.
- Password hashing reutiliza `bcrypt_context` de C-03 — nunca se implementa hashing nuevo aquí.
- El endpoint `verify-branch-assignment` devuelve HTTP 200 con `assigned: false` (en vez de 403) para evitar leaks sobre la estructura de branches/sectores del tenant.
