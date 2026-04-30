## Why

El Dashboard no tiene una página de configuración. Los usuarios con rol MANAGER/ADMIN no pueden editar los datos operativos de su sucursal (nombre, slug del menú público, dirección, teléfono, zona horaria, horarios de atención), cualquier usuario autenticado no puede cambiar su contraseña ni habilitar 2FA desde la UI, y el ADMIN del tenant no puede editar la configuración global del tenant. Hoy todo ese cambio requiere intervención manual en DB. Esto bloquea la autonomía operativa del tenant (HU-0601 Configuración) y deja dos features de seguridad (password change, 2FA enrollment) sin superficie de usuario, aunque el backend de 2FA ya existe desde C-03.

## What Changes

**Frontend Dashboard (ALTO — foco principal):**
- Nueva página `/settings` con layout de tabs y guard por rol por tab, agregada al sidebar bajo el item existente "Configuración"
- **Tab Sucursal** (MANAGER/ADMIN, solo branches asignados): formulario con `useActionState` para editar nombre, slug (regex `^[a-z0-9-]+$`, 3–60 chars, preview en vivo de la URL pública del menú `https://{host}/menu/{slug}`), dirección, teléfono, zona horaria (IANA timezone select) y horarios de atención (7 días, cada uno con lista de intervalos `open/close` en HH:MM, cerrado o 24h)
- **Diálogo de confirmación explícita al cambiar el slug**: muestra la URL vieja y la nueva, pide re-escribir el slug nuevo para confirmar, y advierte que las URLs existentes del menú dejarán de funcionar
- **Tab Perfil** (cualquier rol): (a) formulario de cambio de contraseña con campos `currentPassword`, `newPassword`, `confirmNewPassword` (validación de política de contraseña alineada con `SecurityPolicy` existente: 8–128 chars, min 1 dígito, min 1 mayúscula); (b) subsección de 2FA con 3 estados — deshabilitado (botón "Habilitar" que inicia flow QR→verificación TOTP), habilitado (botón "Deshabilitar" que pide código TOTP actual), y wizard activo (muestra QR + secreto base32 + input de código)
- **Tab Tenant** (solo ADMIN): formulario para editar nombre del tenant
- `useActionState` en todos los formularios, feedback inline por campo, toasts para éxito/error, accesibilidad WAI-ARIA (tablist/tabpanel, aria-describedby en errores)
- `HelpButton` en cada tab con contenido específico del dominio (obligatorio por `help-system-content` skill)
- Nuevo store `settingsStore.ts` (Zustand, selectores + useShallow + EMPTY_ARRAY) con estado `branchSettings`, `tenantSettings`, flags de loading/error; acciones `fetchBranchSettings`, `updateBranchSettings`, `fetchTenantSettings`, `updateTenantSettings` — el password y 2FA se manejan directo via `authAPI` sin store (operaciones transitorias)
- Services: `settingsAPI.ts` (branch + tenant endpoints) y extensión de `authAPI.ts` con `changePassword`, `setup2FA`, `verify2FA`, `disable2FA` (los tres últimos wrappers de endpoints existentes)

**Backend delta mínimo (necesario para completar la UI):**
- **Nuevo endpoint** `POST /api/auth/change-password` (body: `current_password`, `new_password`) — verifica contraseña actual en tiempo constante, valida nueva vs política, rota `password_updated_at`, NO invalida tokens existentes (decisión de seguridad: evitar lockout post-cambio); emite evento de auditoría `USER_PASSWORD_CHANGED`
- **Nuevo endpoint** `PATCH /api/admin/branches/{branch_id}` (requires MANAGER+ branch access): actualiza `name`, `slug` (validar único por tenant), `address`, `phone`, `timezone`, `opening_hours` — invalida cache Redis del menú público asociado al slug viejo y nuevo
- **Nuevo endpoint** `PATCH /api/admin/tenants/me` (requires ADMIN): actualiza `name` del tenant del usuario
- **Nuevos endpoints de lectura** `GET /api/admin/branches/{branch_id}/settings` y `GET /api/admin/tenants/me` (devuelven solo los campos editables + metadata, NO exponen `privacy_salt` del tenant)
- **Migración Alembic**: agregar a `branch` las columnas `phone VARCHAR(50) NULL`, `timezone VARCHAR(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'`, `opening_hours JSONB NULL` (estructura: `{"mon": [{"open": "09:00", "close": "23:00"}], ...}`)
- Nuevos Domain Services: `BranchSettingsService` y `TenantSettingsService` (ambos `BranchScopedService`/`BaseCRUDService` pattern); extensión de `AuthService` con `change_password`

**Testing:**
- Frontend: tests de form validations (slug regex, password policy, confirmNewPassword match), guard de rol por tab (WAITER ve solo Perfil, MANAGER ve Sucursal+Perfil, ADMIN ve todos), flow de 2FA happy path, dialogo de confirmación de slug, password change happy + sad (current incorrecta)
- Backend: tests de `change_password` (current incorrecta, política fallida, happy path con rotación de `password_updated_at`), tests de `update_branch_settings` (slug duplicado 409, timezone inválido 422, horarios inválidos 422, invalidación de cache), tests de `update_tenant` (solo ADMIN)

## Capabilities

### New Capabilities

- `dashboard-settings-ui`: Página de configuración multi-tab en el Dashboard con tabs Sucursal, Perfil y Tenant, gateadas por rol; formularios con useActionState y feedback inline; flow completo de 2FA (setup/verify/disable) y cambio de contraseña; confirmación explícita de cambio de slug
- `branch-settings`: Endpoints REST y servicios de dominio para editar los datos operativos de una sucursal (nombre, slug, dirección, teléfono, timezone, horarios); incluye modelo de datos extendido y reglas de validación/unicidad
- `tenant-settings`: Endpoints REST y servicios de dominio para editar los datos globales del tenant (nombre), restringidos a ADMIN del tenant
- `password-change`: Endpoint REST y servicio de dominio para cambio de contraseña autenticado (requiere contraseña actual), alineado con la política existente de `SecurityPolicy`

### Modified Capabilities

- `two-factor-auth`: Sin cambios en los endpoints (ya existen `setup/verify/disable`), pero se agrega el requirement de que la UI del Dashboard DEBE exponer el flow completo desde la página de Settings — se agrega la delta spec para documentar el requirement de UI consumer

## Impact

**Frontend (Dashboard):**
- `Dashboard/src/pages/Settings.tsx` — nueva página con tabs
- `Dashboard/src/components/settings/` — nueva carpeta con `BranchSettingsForm.tsx`, `ProfileForm.tsx`, `PasswordChangeForm.tsx`, `TwoFactorSection.tsx`, `TenantSettingsForm.tsx`, `SlugChangeDialog.tsx`, `OpeningHoursEditor.tsx`
- `Dashboard/src/stores/settingsStore.ts` — nuevo store Zustand
- `Dashboard/src/services/settingsAPI.ts` — nuevo service
- `Dashboard/src/services/authAPI.ts` — extensión con `changePassword`, `setup2FA`, `verify2FA`, `disable2FA`
- `Dashboard/src/types/settings.ts` — nuevos tipos `BranchSettings`, `TenantSettings`, `OpeningHoursWeek`
- `Dashboard/src/utils/helpContent.tsx` — entradas para cada tab de settings
- `Dashboard/src/App.tsx` — ruta `/settings`
- `Dashboard/src/components/layout/Sidebar.tsx` — ítem "Configuración" → `/settings`

**Backend:**
- `backend/rest_api/routers/auth.py` — endpoint `POST /change-password`
- `backend/rest_api/routers/admin_branches.py` — nuevo router (`PATCH`, `GET`)
- `backend/rest_api/routers/admin_tenants.py` — nuevo router (`PATCH /me`, `GET /me`)
- `backend/rest_api/services/auth_service.py` — método `change_password`
- `backend/rest_api/services/domain/branch_settings_service.py` — nuevo Domain Service
- `backend/rest_api/services/domain/tenant_settings_service.py` — nuevo Domain Service
- `backend/rest_api/schemas/branch.py` — schemas `BranchSettingsUpdate`, `BranchSettingsResponse`, `OpeningHoursWeek`
- `backend/rest_api/schemas/tenant.py` — schemas `TenantSettingsUpdate`, `TenantSettingsResponse`
- `backend/rest_api/schemas/auth.py` — schema `ChangePasswordRequest`
- `backend/rest_api/models/branch.py` — columnas `phone`, `timezone`, `opening_hours`
- `backend/alembic/versions/NNN_branch_settings_fields.py` — nueva migración
- `backend/rest_api/main.py` — incluir nuevos routers
- `backend/rest_api/services/cache/menu_cache.py` — invalidación de cache al cambiar slug (hook)

**Tests:**
- `Dashboard/src/pages/Settings.test.tsx`, `Dashboard/src/components/settings/*.test.tsx`
- `Dashboard/src/stores/settingsStore.test.ts`
- `backend/tests/test_auth_change_password.py`
- `backend/tests/test_admin_branches_router.py`
- `backend/tests/test_admin_tenants_router.py`
- `backend/tests/test_branch_settings_service.py`
- `backend/tests/test_tenant_settings_service.py`

**Dependencies**: C-29 (archivado — branchStore con `selectedBranchId`), C-03 (archivado — 2FA endpoints, JWT auth, SecurityPolicy).

**Governance**: ALTO (tocan auth flows y edición de identidad pública del menú — cambio de slug rompe URLs externas).

**Not in scope**:
- Configuración de notificaciones por usuario (fuera de roadmap)
- Gestión de API keys / webhooks (futuro)
- Billing & planes del tenant (ya cubierto por `dashboard-billing`)
- Internationalization de la UI del Dashboard (Dashboard es ES-AR fijo)
- Password reset vía email (diferente de change password; futuro)
- Invalidación global de sesiones post-change-password (decisión de no forzar logout)
