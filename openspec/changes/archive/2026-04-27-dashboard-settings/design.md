## Context

El Dashboard (React 19, puerto 5177) hoy no tiene página de `/settings`. El sidebar ya muestra un ítem "Configuración" como placeholder. El backend tiene los endpoints de 2FA desde C-03 (`/api/auth/2fa/setup|verify|disable`) y los modelos `User.hashed_password`, `User.password_updated_at`, `User.is_2fa_enabled`, `User.totp_secret` ya existen y están migrados. Lo que NO existe:

- Endpoint `POST /api/auth/change-password` ni método `AuthService.change_password`
- Routers `admin_branches` y `admin_tenants` (update)
- Columnas `phone`, `timezone`, `opening_hours` en tabla `branch`

**Restricciones del stack y del proyecto:**
- React 19 obliga a `useActionState` + `<form action={...}>` para todo formulario nuevo (skill `react19-form-pattern`). Nada de `onSubmit` + `useState` manual.
- Zustand 5: selectores + `useShallow` para objetos/arrays, `EMPTY_ARRAY` estable; nunca destructuring (skill `zustand-store-pattern`).
- Clean Architecture: router thin → Domain Service → Repository. Todo tocado por tenant DEBE filtrar por `tenant_id` (skill `clean-architecture`).
- 2FA ya usa `pyotp` y `User.totp_secret` encrypted at rest.
- Cache Redis del menú público indexado por `slug` — cambiar slug invalida cache vieja y nueva (ver skill `redis-best-practices`).
- Tests obligatorios en TDD (skill `test-driven-development`): test first, luego implementación.
- Governance ALTO: cambios a auth y a la identidad pública del menú. Cualquier riesgo de lockout o de URLs rotas requiere mitigación explícita.

**Stakeholders:**
- ADMIN y MANAGER del tenant (usuarios primarios de Sucursal y Tenant)
- Cualquier staff autenticado (usuario de Perfil)
- Seguridad: policy de contraseñas y 2FA ya establecidas — este change las expone en UI

## Goals / Non-Goals

**Goals:**
- Una sola página `/settings` con tabs visibles solo según rol: WAITER/KITCHEN ven solo Perfil; MANAGER ve Sucursal + Perfil; ADMIN ve Sucursal + Perfil + Tenant.
- Formularios robustos: validación cliente + servidor, feedback inline por campo, estados de carga explícitos, imposibilidad de doble-submit.
- Cambio de slug reversible hasta el confirm: UI pide re-escribir el slug nuevo (patrón GitHub delete repo) y muestra el impacto. Post-submit, invalidar cache Redis vieja y precalentar la nueva.
- 2FA end-to-end desde la UI: enrolar (QR + secret base32 + verify), deshabilitar (code TOTP), mostrar estado actual de forma clara.
- Password change autenticado, con política alineada al `SecurityPolicy` ya existente.
- Todos los endpoints nuevos emiten event logs con `tenant_id`, `user_id`, `request_id` (usa `get_logger`).
- Cobertura de tests: backend ≥90% en nuevos servicios, frontend con tests de validación + guards de rol.

**Non-Goals:**
- Reset de contraseña vía email o recuperación sin sesión (eso es otro change).
- Forzar logout global al cambiar contraseña (decisión explícita: ver Decisión #5).
- Configurar notificaciones push / email por usuario.
- Rotación de tokens JWT desde UI.
- Configurar branch como "cerrado temporalmente" (eso es runtime, no settings; usa `is_active` de branch que es gestión de ADMIN en otro flow).
- I18n del Dashboard (queda ES-AR fijo).
- Settings del tenant más allá de `name` (los demás campos como logo, plan, etc. son otros changes).

## Decisions

### 1. Ubicación y agrupación: una página con tabs vs rutas anidadas (`/settings/branch`, `/settings/profile`)

**Elegido**: una sola ruta `/settings` con state local de tab activo, sincronizado a query string (`/settings?tab=profile`).

**Alternativas consideradas:**
- Rutas anidadas con `<Outlet />` — más "canonical" en React Router, pero multiplica boilerplate (4 componentes de ruta en vez de 1), y para 3 tabs con una sola página conceptual es overkill.
- Tab state solo en memoria — pierde el tab activo tras refresh; el query param resuelve eso sin costo.

**Por qué tabs + query param:**
- Una sola URL compartible por rol (el guard por tab se hace por render condicional, no por ruta).
- El tab activo sobrevive refresh y es shareable (`?tab=profile` enlaza directo a Perfil).
- Menos componentes de router, menos superficie de bugs.

### 2. Formularios: `useActionState` con FormData vs react-hook-form

**Elegido**: `useActionState` + `<form action={serverAction}>` con FormData, alineado con la skill `react19-form-pattern`. Validación con esquemas simples en TS (sin Zod para no sumar dep) o Zod si ya está en el repo — verificar en el apply.

**Alternativas consideradas:**
- react-hook-form: maduro pero anti-patrón con React 19 transitions. No lo usa el resto del Dashboard.
- Formik: deprecated de facto.

**Por qué useActionState:**
- Estándar del proyecto (branch-selector, menu, operations ya lo usan).
- Integra nativamente con transitions (`isPending` gratis).
- Menos JS al cliente.

### 3. Slug change: soft vs hard + gracia vs inmediato

**Elegido**: hard change inmediato + invalidación de cache + diálogo de confirmación que obliga a re-escribir el slug nuevo.

**Alternativas consideradas:**
- Aliases (viejo slug → nuevo por N días): complejo; requiere tabla extra y lógica de redirección pública. Sin demanda documentada.
- Soft change con background job: sobreingeniería para un evento raro.

**Por qué hard inmediato:**
- Patrón conocido (GitHub rename repo). El usuario firma explícitamente el cambio.
- La UX cubre el riesgo con (1) texto de advertencia grande, (2) URL vieja + URL nueva visibles, (3) campo de confirmación.

**Mitigación del riesgo de URL rota**: la advertencia debe ser imposible de ignorar; el diálogo tiene `role="alertdialog"` y botón de confirm deshabilitado hasta que el texto re-escrito matchee.

### 4. Opening hours: shape JSONB

**Elegido**: JSONB en `branch.opening_hours` con shape:
```json
{
  "mon": [{"open": "09:00", "close": "14:00"}, {"open": "20:00", "close": "23:30"}],
  "tue": [{"open": "09:00", "close": "23:00"}],
  "wed": [],
  "thu": [{"open": "00:00", "close": "24:00"}],
  "fri": [{"open": "09:00", "close": "23:00"}],
  "sat": [],
  "sun": []
}
```
- Claves fijas `mon..sun` (no array de días) — facilita merge y default.
- Cada día es una lista de intervalos (soporta partido mediodía/noche).
- `[]` = cerrado. `[{"open": "00:00", "close": "24:00"}]` = 24h.
- Validación en Pydantic: intervalos no solapan, `open < close`, formato HH:MM 24h.

**Alternativas consideradas:**
- Tabla normalizada `branch_opening_hours(day, open, close)`: puro overhead para un dato de 7 filas que se escribe y lee junto.
- String libre ("L-V 9-23"): imposible de validar y usar programáticamente.

**Por qué JSONB:**
- Dato jerárquico pequeño (≤30 intervalos).
- PostgreSQL JSONB permite query si en el futuro hace falta ("¿qué branches están abiertas a las 22:00?").
- Frontend lo consume tal cual sin mapeos.

### 5. Change password: ¿invalida tokens existentes?

**Elegido**: NO invalida tokens existentes. El `password_updated_at` se rota, se loggea el evento, pero los JWTs vivos siguen válidos hasta su expiración natural (15 min access / 7 días refresh).

**Alternativa considerada (rechazada):**
- Tras change password, invalidar todos los refresh tokens del usuario (blacklist vía Redis set por `user_id`) y forzar re-login.

**Por qué no invalidar:**
- UX: el usuario acaba de autenticarse y acaba de cambiar la contraseña conscientemente. Forzarle logout es anti-UX.
- El riesgo mitigado (sesión hijackeada que aún vive) es bajo: si el atacante tiene el refresh cookie, no puede pasar el check de `current_password` (asumiendo que no conoce la actual). Si conoce la actual, el problema es otro.
- Precedente: la mayoría de apps SaaS (GitHub, Vercel, Notion) NO invalidan la sesión actual al cambiar password; solo si el change viene de reset de email.

**Riesgo residual**: si un atacante con sesión viva cambia la contraseña y el usuario legítimo está offline, la sesión atacante no se cortará hasta los 7 días. **Mitigación**: el evento `USER_PASSWORD_CHANGED` se loggea con IP; en C-23 (monitoring) existe alerta de "password change desde IP distinta a la de login"; y el futuro change "devices / active sessions" permitirá revocar sesiones manualmente.

### 6. Role guards: ¿solo frontend o también backend?

**Elegido**: defensa en profundidad — guard en frontend (no renderiza tab ni pide endpoints) + guard en backend via `PermissionContext` (devuelve 403 aunque se llame directo).

**Por qué ambos:**
- Frontend solo = inseguro (se bypasea con curl).
- Backend solo = mala UX (usuario ve tab y se le rompe al enviar).

### 7. Tenant settings: ¿ruta `/api/admin/tenants/{id}` o `/api/admin/tenants/me`?

**Elegido**: `/api/admin/tenants/me` (siempre el tenant del usuario autenticado).

**Por qué:**
- Multi-tenant: un usuario SIEMPRE pertenece a UN tenant. Pasar `{id}` invita a bugs de IDOR (Insecure Direct Object Reference). `/me` hace el scoping explícito.
- Consistente con `/api/auth/me`.

### 8. Dónde se emite la invalidación de cache del menú público al cambiar slug

**Elegido**: en `BranchSettingsService.update_branch_settings`, tras `safe_commit(db)`, dentro del mismo request (síncrono). Llama a `menu_cache.invalidate(slug_old)` y `menu_cache.invalidate(slug_new)` (sobra una, pero es barato y correcto).

**Alternativa considerada:**
- Listener SQLAlchemy `after_flush` sobre `Branch.slug`: elegante pero opaco; harder to test.
- Worker async vía Redis queue: overkill para una operación manual que pasa una vez cada rara vez.

### 9. 2FA UI state machine

Tres estados en `<TwoFactorSection>`:
- **disabled** (`user.is2FAEnabled === false`, no setup activo): botón "Habilitar"
- **setup-pending** (after `setup2FA()` succeeded): muestra QR (usa lib `qrcode.react` si ya está en package.json; fallback: render por URL `otpauth://`), secret base32 copiable, input TOTP, botón "Verificar" (llama `verify2FA`). Botón "Cancelar" descarta.
- **enabled** (`user.is2FAEnabled === true`): texto "2FA activo", botón "Deshabilitar" que abre modal pidiendo código TOTP actual.

Estado local (no en store): es transitorio a la página. `authStore.user.is2FAEnabled` se refresca post-operación vía `refreshMe()`.

### 10. Validación de timezone

Usar lista IANA desde el propio navegador: `Intl.supportedValuesOf('timezone')` (disponible en Chrome 99+, Safari 15.4+, todas las targets del Dashboard). Renderizar select agrupado por continente. Backend valida con `zoneinfo.ZoneInfo(tz)` — si falla, 422.

**Alternativa**: package `moment-timezone` → 900kB extra, no.

## Risks / Trade-offs

- **[Riesgo]** Cambio de slug rompe URLs públicas del menú guardadas en redes sociales / bookmarks de los diners.
  **Mitigación**: diálogo de confirmación explícita con re-escritura; logs del cambio para auditoría; documentación al usuario final. Out-of-scope: redirección automática del slug viejo (futuro change si hay demanda).

- **[Riesgo]** Usuario con sesión comprometida puede cambiar la contraseña del dueño legítimo.
  **Mitigación**: `current_password` es obligatoria (atacante necesita conocerla); logs del evento con IP; alerta de monitoring en C-23. No invalidamos tokens intencionalmente (ver Decisión #5).

- **[Riesgo]** Race condition: dos admins editan la misma branch simultáneamente, pierden cambios.
  **Mitigación**: no usamos optimistic locking (sería over-engineering para settings). Last write wins. El log muestra quién/cuándo. Aceptable por baja frecuencia.

- **[Riesgo]** Usuario deshabilita 2FA sin código (ej: cambió de teléfono).
  **Mitigación**: endpoint `disable_2fa` requiere código TOTP actual (ya implementado en C-03). Si el usuario perdió el dispositivo, el flow de recovery es ADMIN → DB manual. Out-of-scope: backup codes (futuro).

- **[Trade-off]** JSONB en `opening_hours` imposibilita validación de shape a nivel DB sin CHECK constraint complejo.
  **Mitigación**: toda validación en capa Pydantic + service. Los tests del service cubren shapes inválidos.

- **[Trade-off]** Frontend duplica la regex del slug (`^[a-z0-9-]+$`) que también valida el backend.
  **Mitigación**: constante exportada en `types/settings.ts` para que sea la misma literal. Aceptable.

- **[Riesgo]** `Intl.supportedValuesOf('timezone')` puede no estar en navegadores viejos.
  **Mitigación**: fallback a una lista hardcoded de 30 timezones comunes (América/Argentina, Europa principales, EE.UU., Asia). El backend es la fuente de verdad con `zoneinfo`.

## Migration Plan

**Secuencia de deploy:**

1. **DB migration primero** (una sola revisión Alembic):
   ```
   ALTER TABLE branch ADD COLUMN phone VARCHAR(50) NULL;
   ALTER TABLE branch ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';
   ALTER TABLE branch ADD COLUMN opening_hours JSONB NULL;
   ```
   - `timezone` con DEFAULT para no romper filas existentes.
   - `phone` y `opening_hours` nullable — backfill opcional por tenant.

2. **Backend**: deploy endpoints nuevos. Compatible con frontend viejo (ignora columnas extra).

3. **Frontend**: deploy de la página `/settings`. Bajo riesgo — ruta nueva que no existía.

4. **Smoke test post-deploy** (checklist del RUNBOOK):
   - Login ADMIN → ver 3 tabs → editar nombre del tenant → verificar 200
   - Login MANAGER → ver 2 tabs → editar branch → verificar 200
   - Login WAITER → ver solo Perfil → cambiar password → re-login con nueva
   - Activar 2FA → logout → login pide TOTP → OK

**Rollback:**
- Frontend: revertir commit del Dashboard (nada depende de `/settings`).
- Backend: revertir routers (los tests unitarios cubren que ningún otro servicio dependa de ellos).
- DB: migración reversible (downgrade elimina las 3 columnas). Si hay datos en `phone`/`opening_hours`, el downgrade los pierde — documentar.

## Open Questions

- ¿Se audita el cambio de slug en una tabla `audit_log` dedicada o basta con el logger estructurado? Decisión provisoria: logger estructurado (JSON con `event=slug_changed, old, new, tenant_id, user_id`). Si el change `audit-log` posterior se hace tabla, se migra el log. No bloquea este change.
- ¿`opening_hours` debería respetar timezone de la branch o UTC? Decisión provisoria: **timezone local de la branch** (los horarios son humanos, no son UTC). Consistente con UX esperado.
- ¿El frontend debería mostrar un preview del horario semanal en formato legible (ej: "Lun-Vie 9-23, Sáb cerrado")? Out-of-scope de este change; nice-to-have futuro.
- ¿Permitir subir logo de la branch en este change? **No** (out-of-scope; file upload es otro problema con S3/local storage).
