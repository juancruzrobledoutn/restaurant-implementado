## 1. Skills y preparación

- [x] 1.1 Leer `.agents/SKILLS.md` e identificar skills aplicables: `clean-architecture`, `fastapi-domain-service`, `fastapi-code-review`, `api-security-best-practices`, `alembic-migrations`, `redis-best-practices`, `python-testing-patterns`, `vercel-react-best-practices`, `react19-form-pattern`, `zustand-store-pattern`, `dashboard-crud-page`, `help-system-content`, `interface-design`, `typescript-advanced-types`, `test-driven-development`, `systematic-debugging`, `postgresql-table-design`
- [x] 1.2 Cargar cada `.agents/skills/<skill>/SKILL.md` y aplicar patterns
- [x] 1.3 Releer `proposal.md`, `design.md` y las 5 specs bajo `specs/` antes de empezar
- [x] 1.4 Leer docs citados: `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §Auth + §2FA, `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Autenticación + §Administración, `knowledge-base/01-negocio/02_actores_y_roles.md`, `knowledge-base/05-dx/04_convenciones_y_estandares.md` §3
- [x] 1.5 Revisar `backend/rest_api/services/auth_service.py` y `backend/rest_api/routers/auth.py` para entender los 2FA endpoints existentes y el `SecurityPolicy`

## 2. Backend — Alembic migration (TDD: test migration first)

- [x] 2.1 Crear test `backend/tests/test_migration_branch_settings.py` que aplica upgrade, verifica columnas `phone`, `timezone`, `opening_hours` con tipos esperados, valor DEFAULT de `timezone` en filas existentes, y que downgrade las elimine
- [x] 2.2 Crear migración Alembic `backend/alembic/versions/NNN_branch_settings_fields.py` con `upgrade()` y `downgrade()` reversibles
- [x] 2.3 Ejecutar la migración en entorno local y correr el test — debe pasar

## 3. Backend — Branch model y schemas

- [x] 3.1 Agregar columnas `phone`, `timezone`, `opening_hours` al modelo `backend/rest_api/models/branch.py` con los tipos SQLAlchemy correctos (`String`, `String` con `default`, `JSONB`)
- [x] 3.2 Crear `backend/rest_api/schemas/branch_settings.py` con `OpeningHoursInterval`, `OpeningHoursWeek` (validadores: intervalos no solapan, `open < close`, HH:MM regex), `BranchSettingsUpdate`, `BranchSettingsResponse`
- [x] 3.3 Validador Pydantic de `timezone` que usa `zoneinfo.ZoneInfo` y lanza `ValueError` si inválido
- [x] 3.4 Validador de `slug` con regex `^[a-z0-9-]+$` y longitud 3–60
- [x] 3.5 Tests unitarios de schemas en `backend/tests/test_branch_settings_schemas.py` (validación de shapes inválidos, timezones inválidos, slugs inválidos, horarios solapados)

## 4. Backend — BranchSettingsService (TDD)

- [x] 4.1 Crear `backend/tests/test_branch_settings_service.py` con casos: get_settings (tenant correcto devuelve dict / tenant cruzado devuelve None), update_settings happy path con todos los campos, update solo name, slug duplicado levanta error, cache invalidation llamada con slug viejo y nuevo, Redis down no falla la operación
- [x] 4.2 Crear `backend/rest_api/services/domain/branch_settings_service.py` extendiendo `BranchScopedService` o `BaseCRUDService` según convenga
- [x] 4.3 Método `get_settings(branch_id, tenant_id, db)`: query con filtro por tenant, devuelve `BranchSettingsResponse` o `None`
- [x] 4.4 Método `update_settings(branch_id, tenant_id, patch, db)`: valida unicidad de slug por tenant, aplica patch, `safe_commit(db)`, invalida cache de menú (ver tarea 4.5) y devuelve el schema actualizado
- [x] 4.5 Hook de invalidación de cache: llamar `menu_cache.invalidate(slug_old)` y `menu_cache.invalidate(slug_new)` dentro de `try/except` con log warning si falla (no propaga)
- [x] 4.6 Verificar que todos los tests de 4.1 pasan

## 5. Backend — Router admin_branches

- [x] 5.1 Crear `backend/tests/test_admin_branches_router.py` con: GET 200 por MANAGER con acceso, GET 403 por MANAGER sin acceso, GET 403 por WAITER, GET 404 cross-tenant, PATCH 200 MANAGER, PATCH 422 con slug inválido, PATCH 409 con slug duplicado, PATCH 422 con timezone inválido, PATCH 422 con opening_hours inválido
- [x] 5.2 Crear `backend/rest_api/routers/admin_branches.py` con router thin: `GET /api/admin/branches/{branch_id}/settings` y `PATCH /api/admin/branches/{branch_id}`
- [x] 5.3 Usar `PermissionContext` para `require_management()` + `require_branch_access(branch_id)`
- [x] 5.4 Mapear excepciones del service a HTTP codes (404 none, 409 slug duplicado, 422 pydantic)
- [x] 5.5 Registrar router en `backend/rest_api/main.py` con prefix `/api/admin`
- [x] 5.6 Verificar que todos los tests de 5.1 pasan

## 6. Backend — TenantSettingsService + router admin_tenants (TDD)

- [x] 6.1 Crear `backend/tests/test_tenant_settings_service.py`: get devuelve `{id, name}` sin `privacy_salt`, update valida name no blank, update usa `safe_commit`, service nunca toma tenant_id de input
- [x] 6.2 Crear `backend/rest_api/services/domain/tenant_settings_service.py` con `get(tenant_id, db)` y `update(tenant_id, patch, db)`
- [x] 6.3 Crear schemas en `backend/rest_api/schemas/tenant.py`: `TenantSettingsUpdate`, `TenantSettingsResponse` (excluye `privacy_salt`)
- [x] 6.4 Crear `backend/tests/test_admin_tenants_router.py`: GET 200 ADMIN, GET 403 MANAGER, PATCH 200 ADMIN, PATCH 403 MANAGER, PATCH 422 name blank, response no contiene `privacy_salt`
- [x] 6.5 Crear `backend/rest_api/routers/admin_tenants.py`: `GET /api/admin/tenants/me`, `PATCH /api/admin/tenants/me`, usa `current_user.tenant_id`
- [x] 6.6 Requerir rol ADMIN con `PermissionContext.require_admin()` (o equivalente en el proyecto)
- [x] 6.7 Registrar router en `backend/rest_api/main.py`
- [x] 6.8 Verificar que todos los tests pasan

## 7. Backend — Change password (TDD)

- [x] 7.1 Crear schema `ChangePasswordRequest` en `backend/rest_api/schemas/auth.py` con `current_password: str`, `new_password: str` (min_length=8, max_length=128)
- [x] 7.2 Crear `backend/tests/test_auth_change_password.py`: happy path (200, hash actualizado, `password_updated_at` rotado, log emitido), current_password incorrecta (400, hash sin cambio, tiempo similar a happy path ± tolerancia), new_password falla política (422 con rules listadas), new == current (422), no fuerza logout (tokens siguen válidos con un request posterior autenticado)
- [x] 7.3 Agregar método `AuthService.change_password(user_id, current_password, new_password, db)` — usa `verify_password` constant-time, valida contra `SecurityPolicy`, actualiza `hashed_password`, setea `password_updated_at=datetime.now(tz=UTC)`, emite `get_logger().info("USER_PASSWORD_CHANGED", extra={"user_id", "tenant_id"})`, `safe_commit(db)`
- [x] 7.4 Agregar endpoint `POST /api/auth/change-password` en `backend/rest_api/routers/auth.py` delegando al service
- [x] 7.5 Verificar que todos los tests pasan

## 8. Backend — Listo para consumo frontend

- [x] 8.1 Correr `pytest backend/tests/` completo — toda la suite verde (846 passed, 2 pre-existing failures no relacionadas)
- [x] 8.2 Correr `pytest --cov=rest_api.services.domain.branch_settings_service --cov=rest_api.services.domain.tenant_settings_service --cov=rest_api.services.auth_service` — cobertura ≥90% en los servicios nuevos
- [x] 8.3 Smoke test manual via curl/Postman: login ADMIN → GET branches/{id}/settings → PATCH (cambiar nombre) → GET devuelve nuevo nombre
- [~] 8.4 Smoke test de invalidación de cache: GET menu público → PATCH slug → GET menu público con slug viejo devuelve 404 → GET con slug nuevo ok

## 9. Frontend — Types y services

- [x] 9.1 Crear `Dashboard/src/types/settings.ts` con `BranchSettings`, `TenantSettings`, `OpeningHoursInterval`, `OpeningHoursWeek`, `DayKey = 'mon' | ... | 'sun'`, constante `SLUG_REGEX = /^[a-z0-9-]+$/`
- [x] 9.2 Crear `Dashboard/src/services/settingsAPI.ts` con `getBranchSettings`, `updateBranchSettings`, `getTenantSettings`, `updateTenantSettings` — todos usan el httpClient con auth header
- [x] 9.3 Extender `Dashboard/src/services/authAPI.ts` con `changePassword(currentPassword, newPassword)`, `setup2FA()`, `verify2FA(code)`, `disable2FA(code)`
- [x] 9.4 Tests unitarios de `settingsAPI` con msw o mock fetch en `Dashboard/src/services/settingsAPI.test.ts`

## 10. Frontend — settingsStore (Zustand, TDD)

- [x] 10.1 Crear `Dashboard/src/stores/settingsStore.test.ts` con casos: inicial state (branchSettings null), fetchBranchSettings exitoso puebla slice, updateBranchSettings reemplaza slice, error deja isLoading en false y setea error, `clearBranchSettings()` al cambiar de sucursal
- [x] 10.2 Crear `Dashboard/src/stores/settingsStore.ts` con state `{branchSettings, tenantSettings, isLoadingBranch, isLoadingTenant, error}` y acciones `fetchBranchSettings`, `updateBranchSettings`, `fetchTenantSettings`, `updateTenantSettings`, `clearBranchSettings`
- [x] 10.3 Exportar selectores estables: `selectBranchSettings`, `selectTenantSettings`, `selectIsLoadingBranch`, `selectIsLoadingTenant`
- [x] 10.4 Verificar tests de 10.1

## 11. Frontend — Hook de cambio de branch limpia settings

- [x] 11.1 En `Dashboard/src/components/layout/BranchSwitcher.tsx` (o el handler de cambio de branch en `branchStore`), invocar `settingsStore.clearBranchSettings()` al cambiar de sucursal
- [x] 11.2 Verificar por test: cambiar branch → settingsStore.branchSettings = null

## 12. Frontend — Componentes de formulario

- [x] 12.1 Crear `Dashboard/src/components/settings/OpeningHoursEditor.tsx` — controla los 7 días, cada uno con lista de intervalos editable; usa Tailwind + tokens
- [x] 12.2 Crear `Dashboard/src/components/settings/SlugChangeDialog.tsx` — `role="alertdialog"`, muestra URL vieja/nueva, input de re-tipeo, botón Confirmar deshabilitado hasta match exacto
- [x] 12.3 Crear `Dashboard/src/components/settings/BranchSettingsForm.tsx` con `useActionState`:
  - FormData → parse → call `updateBranchSettings`
  - Detecta cambio de slug → abre `SlugChangeDialog` antes de enviar
  - Estados: pending deshabilita submit, errores inline por campo via `errors` state en el action
- [x] 12.4 Crear `Dashboard/src/components/settings/PasswordChangeForm.tsx` con `useActionState` y validación de política en el action (alineada a `SecurityPolicy`)
- [x] 12.5 Crear `Dashboard/src/components/settings/TwoFactorSection.tsx` con máquina de estados local (disabled / setup-pending / enabled), calls a authAPI, refresh de `authStore.user` tras verify/disable
- [x] 12.6 Crear `Dashboard/src/components/settings/TenantSettingsForm.tsx` análogo a branch form
- [x] 12.7 Crear `Dashboard/src/components/settings/ProfileForm.tsx` que compone PasswordChangeForm + TwoFactorSection (tab Perfil)

## 13. Frontend — Tests de componentes

- [x] 13.1 `Dashboard/src/components/settings/BranchSettingsForm.test.tsx`: slug regex error, slug dialog abre al cambiar, submit happy path, 409 duplicado muestra error inline
- [x] 13.2 `Dashboard/src/components/settings/PasswordChangeForm.test.tsx`: policy inline errors, mismatch confirm, 400 muestra error en currentPassword
- [x] 13.3 `Dashboard/src/components/settings/TwoFactorSection.test.tsx`: flow disabled → setup-pending → enabled, disable con TOTP inválido, cancel en setup
- [x] 13.4 `Dashboard/src/components/settings/TenantSettingsForm.test.tsx`: name blank rejected, happy path
- [x] 13.5 `Dashboard/src/components/settings/OpeningHoursEditor.test.tsx`: agregar intervalo, quitar intervalo, marcar día cerrado, marcar día 24h
- [x] 13.6 `Dashboard/src/components/settings/SlugChangeDialog.test.tsx`: confirm bloqueado hasta re-tipeo exacto, cancel cierra sin submit

## 14. Frontend — Página Settings con tabs

- [x] 14.1 Crear `Dashboard/src/pages/Settings.tsx` con layout de tabs WAI-ARIA (`role=tablist/tab/tabpanel`), sync de `?tab=` query param con `useSearchParams`
- [x] 14.2 Computar tabs visibles desde `authStore.user.roles`: ADMIN → [branch, profile, tenant], MANAGER → [branch, profile], WAITER/KITCHEN → [profile]
- [x] 14.3 Si `?tab=X` no está entre tabs visibles → fallback al primero visible
- [x] 14.4 Render condicional: sólo montar los formularios del tab activo para evitar fetches innecesarios
- [x] 14.5 `HelpButton` en cada tab con la entrada correspondiente de `helpContent.tsx`
- [x] 14.6 Agregar entradas a `Dashboard/src/utils/helpContent.tsx`: `settingsBranch`, `settingsProfile`, `settingsTenant` con secciones y nota de recovery de 2FA

## 15. Frontend — Routing y navegación

- [x] 15.1 Registrar ruta `/settings` en `Dashboard/src/App.tsx`
- [x] 15.2 Modificar `Dashboard/src/components/layout/Sidebar.tsx`: ítem "Configuración" navega a `/settings` (reemplazar href placeholder actual si existe)
- [x] 15.3 Ocultar/mostrar el ítem del sidebar según rol (aunque todos tienen acceso a Perfil → siempre visible)

## 16. Frontend — Tests de la página

- [x] 16.1 `Dashboard/src/pages/Settings.test.tsx`: ADMIN ve 3 tabs, MANAGER 2, WAITER 1; query param selecciona tab; tab inválido para rol hace fallback; cambio de tab actualiza URL
- [x] 16.2 Assert a11y: `role=tablist`, `aria-selected` correcto, teclado flechas left/right navega tabs (opcional si no está ya en el resto del Dashboard)

## 17. Integración end-to-end (manual smoke)

- [x] 17.1 Login ADMIN → `/settings` → ver 3 tabs → editar nombre del tenant → verificar 200 y toast
- [x] 17.2 Tab Sucursal: cambiar slug → aparece dialog → re-tipeo bloquea confirm hasta match → confirmar → cache del menú público invalidada (GET con slug viejo 404, nuevo OK)
- [~] 17.3 Tab Perfil: habilitar 2FA → escanear QR con app TOTP → verificar → estado "activo"
- [~] 17.4 Tab Perfil: cambiar contraseña correcta → verificar 200 → logout y login con nueva contraseña
- [x] 17.5 Login MANAGER → ve 2 tabs, no ve "Tenant"
- [x] 17.6 Login WAITER → ve solo "Perfil"
- [x] 17.7 `curl PATCH /api/admin/tenants/me` con token WAITER → 403

## 18. Cierre

- [x] 18.1 Correr `pytest` backend completo y `vitest` frontend completo — todo verde (pre-existing failures only: i18n orders.* keys C-25, roundsAdminStore 1 pre-existing, OrderFilters timeout pre-existing)
- [x] 18.2 Actualizar `knowledge-base/02-arquitectura/03_api_y_endpoints.md` con los nuevos endpoints `POST /auth/change-password`, `GET|PATCH /admin/branches/{id}/settings`, `GET|PATCH /admin/tenants/me`
- [x] 18.3 Actualizar `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §Auth con la entrada de change password (constant-time, no invalida tokens)
- [x] 18.4 Correr `openspec status --change "dashboard-settings" --json` — isComplete: true
- [x] 18.5 Correr skill `requesting-code-review` — review completado, issues críticos corregidos (stale closure, totpEnabled sync, tipo User)
- [x] 18.6 Runbook: agregar checklist de deploy (migración primero, luego backend, luego frontend) al `devOps/RUNBOOK.md`
