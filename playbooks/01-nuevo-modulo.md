# Playbook 1: Nuevo Módulo CRUD

## Cuándo usar
Cuando necesitás implementar una feature completa end-to-end (modelo → migración → servicio → router → store → página → tests).

## Variables a reemplazar
- `{{MODULE_NAME}}`: nombre del módulo (ej: `Reservations`, `Inventory`)
- `{{ENTITY_NAME}}`: nombre de la entidad principal (ej: `Reservation`, `StockItem`)
- `{{DESCRIPTION}}`: descripción funcional del módulo
- `{{FIELDS}}`: campos principales del modelo

## Prompt

```
Necesito implementar el módulo **{{MODULE_NAME}}** completo end-to-end en el monorepo Integrador.

**Contexto del proyecto:**
- Monorepo en {PROJECT_ROOT}
- Backend: FastAPI + SQLAlchemy + PostgreSQL + Redis
- Dashboard: React 19 + Zustand + Tailwind + i18n (es/en)
- Clean Architecture: thin router → domain service → repository
- Soft delete convention, prices in cents, BigInteger IDs

**Qué necesito:**
{{DESCRIPTION}}

**Campos del modelo:**
{{FIELDS}}

**Tareas a ejecutar EN PARALELO** (lanzá los 3 agentes simultáneamente):

### Agente 1: Backend
Crear:
1. Modelo SQLAlchemy en `backend/rest_api/models/{{module_name_lower}}.py`
2. Migración Alembic siguiente en la cadena (leer `backend/alembic/versions/` para ver el último número)
3. Pydantic schemas en `backend/shared/utils/admin_schemas.py`
4. Domain service en `backend/rest_api/services/domain/{{module_name_lower}}_service.py` extendiendo `BranchScopedService` o `BaseCRUDService`
5. Router en `backend/rest_api/routers/admin/{{module_name_lower}}.py` (thin controller)
6. Registrar en `models/__init__.py`, `services/domain/__init__.py`, `routers/admin/__init__.py`
7. Tests en `backend/tests/test_{{module_name_lower}}.py` (mínimo 5 tests)

Leer existentes ANTES de escribir:
- `knowledge-base/05-dx/05_workflow_implementacion.md` (workflow canonical)
- `knowledge-base/05-dx/04_convenciones_y_estandares.md` (convenciones)
- Un servicio existente similar para copiar el pattern

### Agente 2: Dashboard Frontend
Crear:
1. Tipos y API client en `Dashboard/src/services/api.ts`
2. Zustand store en `Dashboard/src/stores/{{moduleName}}Store.ts`
3. Página en `Dashboard/src/pages/{{ModuleName}}.tsx`
4. Ruta en `Dashboard/src/App.tsx`
5. Link en sidebar (`Dashboard/src/components/layout/Sidebar.tsx`)
6. Keys i18n en `Dashboard/src/i18n/locales/es.json` y `en.json`
7. Agregar store a `Dashboard/src/stores/resetAllStores.ts`
8. Tests básicos del store en `Dashboard/src/stores/{{moduleName}}Store.test.ts`

Leer existentes ANTES:
- Una página similar (ej: `Categories.tsx`, `Reservations.tsx`)
- `knowledge-base/05-dx/04_convenciones_y_estandares.md`

### Agente 3: QA + Documentación
1. Verificar que el módulo se integra con los eventos WebSocket si aplica
2. Actualizar `knowledge-base/01-negocio/03_funcionalidades.md` con el nuevo módulo
3. Actualizar `knowledge-base/04-infraestructura/04_migraciones.md` con la nueva migración
4. Actualizar `knowledge-base/01-negocio/04_reglas_de_negocio.md` con las reglas de negocio del módulo
5. Si el módulo tiene roles especiales, actualizar RBAC en `knowledge-base/01-negocio/02_actores_y_roles.md`

## Reglas críticas
- Leer archivos EXISTENTES antes de escribir nuevos
- Seguir convenciones del proyecto (NO inventar patterns nuevos)
- Todo el texto UI en español
- Todos los comentarios de código en inglés
- Usar `t()` para i18n desde el principio
- Soft delete siempre activo (no hard delete)
- Tests mínimo 5 por layer
- Guardar decisiones importantes en engram con `mem_save project:integrador topic_key:feature/{{module_name_lower}}`

## Salida esperada
- Checklist de archivos creados/modificados
- Confirmación de tests corriendo
- Link a la página nueva
- Comando para ejecutar la migración
```

> **Nota**: Reemplazar `{PROJECT_ROOT}` con el path real del proyecto (ej: `E:\ESCRITORIO\programar\2026\jr2`)
