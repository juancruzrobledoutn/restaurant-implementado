## Context

El roadmap OpenSpec (C-13) posiciona este change como el punto donde el backend se completa funcionalmente para que pwaWaiter y el Dashboard operativo puedan existir. Dependencias archivadas: C-02 (User, UserBranchRole, BranchScopedService, `safe_commit`), C-04 (Product, Branch), C-07 (BranchSector, `WaiterSectorAssignment`, `sectors-tables` spec), C-08 (TableSession). Este change NO toca auth (C-03) — asume `bcrypt_context` y `current_user` dependency ya existentes.

Actualmente el modelo de datos (`02_modelo_de_datos.md`) ya define las 3 tablas de promotions (`promotion`, `promotion_branch`, `promotion_item`) y el modelo `outbox_event`, pero no están creadas todavía. Las tablas de push subscription no aparecen documentadas — este change las introduce como extensión natural del mozo pre-login (§02_actores_y_roles.md menciona push como responsabilidad del mozo, pero no especifica el modelo de datos).

Constraints:
- Multi-tenant: promotions son tenant-scoped; staff es multi-tenant via `UserBranchRole.branch.tenant_id`.
- Governance ALTO: los endpoints admin de staff tocan contraseñas → SOLO reuso del hashing existente, cero criptografía nueva aquí.
- El outbox processor (worker que lee `outbox_event` y publica a Redis Streams) NO entra acá — queda para C-09 o C-10. Acá solo el modelo + write helper.
- Push notifications requieren claves VAPID fuera del repo (en `.env`). El service falla abierto: si no hay claves, `PushNotificationService.send_to_user` loguea WARNING y retorna sin enviar (no crashea el flujo de negocio).

Stakeholders:
- ADMIN/MANAGER via Dashboard (consumen endpoints `/api/admin/staff`, `/api/admin/promotions`, `/api/admin/waiter-assignments`).
- WAITER via pwaWaiter (consume `/api/waiter/verify-branch-assignment` y `/api/waiter/notifications/subscribe`).
- Changes posteriores (C-10, C-11, C-12) que consumirán `OutboxService.write_event` y `PushNotificationService.send_to_user`.

## Goals / Non-Goals

**Goals:**
- Entregar CRUD completo de usuarios con asignación M:N de roles por branch, con las reglas de permisos correctas (ADMIN delete, MANAGER sin delete).
- Entregar CRUD de promotions tenant-scoped con vinculación a branches y productos.
- Implementar el endpoint `verify-branch-assignment` que resuelve la fecha de HOY (UTC del tenant) contra `WaiterSectorAssignment`.
- Exponer endpoints admin para gestionar asignaciones diarias de mozos.
- Agregar la tabla `outbox_event` y el `OutboxService.write_event` atómico — base de infraestructura.
- Agregar la tabla `push_subscription` y el `PushNotificationService.send_to_user` usando `pywebpush`.
- Todos los endpoints respetan aislamiento multi-tenant; `PermissionContext.require_management()` en todos los admin endpoints.
- Cobertura de tests: CRUD + casos negativos de permisos, idempotencia de subscribe, vigencia temporal de promotions, atomicidad del outbox.

**Non-Goals:**
- NO implementar el background worker del outbox (`outbox_processor.py`). Eso es parte de C-09 o C-10.
- NO disparar push notifications desde eventos reales (ROUND_READY, SERVICE_CALL_CREATED, CHECK_REQUESTED). Eso es parte de C-10/C-11/C-12. Acá solo se provee el service.
- NO crear UI en Dashboard ni pwaWaiter. Esos son C-16 y C-20 respectivamente.
- NO implementar renovación de VAPID keys ni rotación — claves estáticas en `.env`.
- NO cambiar auth ni hashing de contraseñas. Reutiliza lo de C-03.
- NO crear el modelo `Customer` ni nada de loyalty (C-19).

## Decisions

### D-01: `OutboxEvent` vive en este change, no en C-09 ni C-12

**Decisión**: crear el modelo `OutboxEvent` + `OutboxService.write_event` en C-13, aunque el primer consumidor real sea C-10 (rounds).

**Razón**: la knowledge-base (§04_eventos_y_websocket.md) ya documenta el patrón transaccional y varios scopes lo consumirán (rounds, kitchen, billing, service calls). Si lo dejamos para C-09, acoplamos la infraestructura con el gateway. Si lo dejamos para C-12, tenemos duplicación en C-10/C-11. C-13 es el primer change que tiene un motivo legítimo para escribir un evento via outbox (eventualmente para notificaciones de asignación de turno) y encaja bien en su governance ALTO. Además, C-13 corre en paralelo con C-09 (según el plan en `CHANGES.md`), así que colocar el Outbox acá desacopla el camino crítico.

**Alternativas consideradas**:
1. Outbox en C-09 → pero C-09 es WebSocket Gateway, no tiene por qué owner el modelo transaccional del REST API.
2. Outbox en C-10 rounds → acopla una primitiva de infra a un change de negocio; si después hay que cambiarla hay que tocar rounds.
3. Crear un change nuevo "C-08.5 outbox-infra" → demasiado granular, sobrecarga el pipeline.

**Tradeoff**: si C-13 se posterga, el outbox se posterga también. Mitigación: C-13 está en GATE 6 (misma fase que C-09), entonces el camino crítico sigue abierto (C-09 no necesita outbox para funcionar — solo los eventos outbox-garantizados lo necesitarán en C-10+).

### D-02: El worker del outbox se difiere a un change posterior

**Decisión**: este change crea la tabla `outbox_event` y el helper `write_event` pero NO implementa el background worker que lee eventos pendientes y publica a Redis Streams.

**Razón**: el worker requiere Redis Streams operativo (eso es C-09 ws-gateway-base) y un consumer group con DLQ. Adelantarlo genera deuda técnica si C-09 aún no está archivado. En paralelo, sin worker, `OutboxEvent.processed_at` permanece `NULL` — eso es **aceptable en este change** porque este change no escribe eventos críticos (no hay producer en el scope de C-13). El primer producer real aparece en C-10.

**Riesgo**: si alguien activa accidentalmente el outbox en C-13 (por ejemplo, un test que escribe) los eventos se acumulan sin procesar. Mitigación: el único call-site interno en este change es opcional (notificación de asignación de turno), y la documentación del service aclara que `write_event` requiere el worker para surtir efecto.

### D-03: `verify-branch-assignment` devuelve HTTP 200 con `{ assigned: false }`

**Decisión**: el endpoint `GET /api/waiter/verify-branch-assignment` NUNCA devuelve 403/404. Siempre HTTP 200 con `{ assigned: bool, sector_id?: int, sector_name?: string }`.

**Razón**: si devolvemos 403, un mozo malicioso puede usar el endpoint para enumerar branches/sectores del tenant. Con 200+payload, no hay leak: la respuesta es constante en estructura. Además, el frontend de pwaWaiter necesita el `sector_id` para pintar la UI, entonces el payload es útil funcionalmente. La UI es la que decide mostrar "Acceso Denegado" si `assigned=false`.

**Alternativa**: 403 con mensaje genérico. Descartada porque mezcla semánticas (permiso ≠ asignación diaria).

### D-04: `PushSubscription.endpoint` es UNIQUE global

**Decisión**: el campo `endpoint` del modelo `PushSubscription` tiene unique constraint global (no por user_id).

**Razón**: las URLs de VAPID (FCM, Mozilla autopush) son globalmente únicas — cada navegador genera un endpoint único por registro. Si dos usuarios comparten un endpoint significa que uno se deslogueó y otro se logueó en el mismo dispositivo → queremos **upsert por endpoint**, no duplicar. El `subscribe()` hace `INSERT ... ON CONFLICT (endpoint) DO UPDATE SET user_id = :new_user_id, is_active = true`.

**Riesgo**: si el navegador A cambia su endpoint tras un tiempo, quedan registros zombies. Mitigación: el service marca `is_active = false` en un endpoint que devuelve 410 Gone al enviar, y el background job limpia. Acá solo se planta la bandera — la limpieza queda para C-23 monitoring.

### D-05: Separación `StaffService` vs `WaiterAssignmentService`

**Decisión**: los endpoints de staff (`/api/admin/staff`) y los de asignaciones (`/api/admin/waiter-assignments`) tienen servicios separados.

**Razón**: `StaffService` maneja el modelo `User` + `UserBranchRole` (CRUD pesado con hashing, validaciones de email único, soft delete cascade). `WaiterAssignmentService` maneja solo `WaiterSectorAssignment` (CRUD liviano, consultas por fecha). Separar mantiene cada uno bajo 200 LOC y respeta SRP. El endpoint `verify-branch-assignment` también queda en `WaiterAssignmentService`.

### D-06: `StaffService` extiende `BranchScopedService`, no `BaseCRUDService`

**Decisión**: `StaffService(BranchScopedService[User, UserOut])`.

**Razón**: los queries de staff siempre filtran por los branches del usuario que ejecuta (ADMIN → todos los del tenant, MANAGER → solo los asignados). `BranchScopedService` ya provee este filtrado automático. Usar `BaseCRUDService` obligaría a reimplementar el scoping en cada método.

**Riesgo**: `User` no tiene `branch_id` directo (es M:N via `UserBranchRole`). `BranchScopedService` asume `Model.branch_id`. Mitigación: override del método `_apply_branch_filter` para hacer join con `UserBranchRole` y filtrar por `UserBranchRole.branch_id IN (accessible_branches)`.

### D-07: Promotions vencidas se muestran pero no se aplican

**Decisión**: `PromotionService.list_for_branch()` devuelve todas las promotions del branch, incluyendo vencidas (`end_date < today`). El precio promocional solo se aplica cuando la promoción está vigente.

**Razón**: el dashboard necesita ver el histórico de promotions. Filtrar por vigencia es responsabilidad de la UI o del endpoint público del menú (que está fuera de este change — vive en C-04 y se actualiza en C-15). Acá solo entregamos el CRUD crudo.

### D-08: Migración 010 crea TODAS las tablas nuevas en un solo step

**Decisión**: una sola migración Alembic `010_staff_management.py` con 5 tablas: `outbox_event`, `promotion`, `promotion_branch`, `promotion_item`, `push_subscription`.

**Razón**: las 5 tablas son independientes entre sí (no hay FK cruzadas) y se activan todas juntas con el service layer. Una sola migración es atómica, tiene `upgrade()` y `downgrade()` claros, y reduce overhead.

**Alternativa**: 3 migraciones (010 outbox, 011 promotions, 012 push) → descartada por overhead operativo, pero si el change crece, se splittea.

### D-09: `pywebpush` sobre `py-vapid`

**Decisión**: usar `pywebpush==2.0.0+` para el envío de notifications, no implementar VAPID JWT manual.

**Razón**: `pywebpush` ya maneja encriptación (RFC 8291), headers de FCM/Mozilla autopush y negociación VAPID. Reimplementar es overkill y riesgoso (criptografía).

**Riesgo**: dependencia externa (`cryptography`, `py-vapid`). Mitigación: versión pineada en `requirements.txt`, tests mockean `pywebpush.webpush` para no depender de red real.

### D-10: Fecha de "hoy" para asignaciones usa `date.today()` en UTC

**Decisión**: `verify-branch-assignment` compara `WaiterSectorAssignment.date == date.today()` usando UTC.

**Razón**: el sistema es multi-tenant internacional (AR/UY/BR). Usar timezone del tenant requiere schema extra (`Tenant.timezone`). Para este change se acepta UTC como MVP. La UI puede mostrar la fecha localizada.

**Open question**: ¿agregar `Tenant.timezone` ahora o diferirlo? Decidido diferir — ver Open Questions.

## Risks / Trade-offs

- **Riesgo**: `OutboxEvent` sin worker acumula registros huérfanos. → **Mitigación**: en este change no hay producer real (solo el helper). Documentar en `OutboxService` que `write_event` requiere worker activo. C-10 arranca el worker.
- **Riesgo**: `PushSubscription.endpoint` con 500 chars podría no alcanzar (algunos endpoints FCM pasan los 512). → **Mitigación**: usar `String(2048)` en la columna, el índice unique sobre el campo maneja el tamaño.
- **Riesgo**: `StaffService` con `BranchScopedService` requiere join con `UserBranchRole` → performance. → **Mitigación**: índice compuesto sobre `(user_id, branch_id)` ya existe (creado en C-02). Query usa `selectinload` para N+1.
- **Riesgo**: timezone UTC puede mostrar "ayer" al WAITER en países con offset negativo. → **Mitigación**: aceptado como MVP, ticket diferido en Open Questions.
- **Riesgo**: `verify-branch-assignment` no verifica si el WAITER está activo (`is_active`). → **Mitigación**: se verifica en `current_user` (dependency de C-03), no aquí.
- **Trade-off**: no hay endpoint para "refrescar mi asignación" en tiempo real. Si el mozo entra a las 8am y lo reasignan a las 10am, tiene que cerrar sesión y volver a entrar. Aceptado: uso real es que la asignación es del día entero.
- **Trade-off**: el `PromotionService` no valida que los productos vinculados pertenezcan al mismo tenant. → **Mitigación**: se valida en el service con un check explícito `product.branch.tenant_id == promotion.tenant_id`.

## Migration Plan

1. **Pre-deploy**: generar VAPID keypair con `py-vapid generate` (o `web-push generate-vapid-keys`), guardar en `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`).
2. **Deploy**: `alembic upgrade 010` aplica la migración. Las 5 tablas son nuevas → no hay data loss posible.
3. **Smoke test post-deploy**:
   - `POST /api/admin/staff` con ADMIN → crea usuario con rol WAITER en branch.
   - `POST /api/admin/waiter-assignments` → asigna el usuario a un sector HOY.
   - `GET /api/waiter/verify-branch-assignment?branch_id=1` (con JWT del waiter) → devuelve `assigned: true`.
   - `POST /api/waiter/notifications/subscribe` con body VAPID válido → devuelve 201 con `subscription_id`.
4. **Rollback**: `alembic downgrade 009`. Las 5 tablas se droppean — no hay dependencias inversas desde changes anteriores porque son nuevas.

## Open Questions

- **OQ-01**: ¿El `Tenant` necesita un campo `timezone`? Recomendación: diferir a un change dedicado en FASE 2, usar UTC como MVP. Decisión esperada del usuario.
- **OQ-02**: ¿La suscripción push debe estar limitada a usuarios con rol WAITER, o también ADMIN/MANAGER/KITCHEN? Recomendación: WAITER por ahora, abrir a otros roles cuando C-16 dashboard-operations lo necesite.
- **OQ-03**: ¿El endpoint `verify-branch-assignment` acepta `branch_id` como query param obligatorio? Alternativa: sin param, devuelve la lista de assignments activas HOY y el frontend elige. Recomendación: mantener `branch_id` obligatorio — matchea el flujo pre-login documentado en §02_actores_y_roles.md.
- **OQ-04**: ¿Se necesita endpoint `/api/admin/staff/{id}/branches` (GET) para listar los branches de un user? Agregar si los tests muestran demanda.
