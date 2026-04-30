# Playbook 4: Release Preparation

## Cuándo usar
Antes de un deploy a producción.

## Variables a reemplazar
- `{{VERSION}}`: versión a desplegar (ej: `v1.2.0`)
- `{{BRANCH}}`: branch de release (ej: `release/v1.2.0`)

## Prompt

```
Preparar release {{VERSION}} del proyecto Integrador.

**Proyecto:** {PROJECT_ROOT}
**Branch:** {{BRANCH}}

**Estrategia: 3 agentes en paralelo**

### Agente 1: Build Validation
1. Verificar que cada componente compila sin errores:
   - Backend: `cd backend && python -m pytest tests/ -v --tb=short` (tests deben pasar)
   - Dashboard: `cd Dashboard && npm run type-check && npm run lint && npm run build`
   - pwaMenu: `cd pwaMenu && npm run type-check && npm run lint && npm run build`
   - pwaWaiter: `cd pwaWaiter && npm run type-check && npm run lint && npm run build`
2. Verificar que los Docker images buildean:
   - `cd devOps && docker compose build`
3. Reportar cualquier warning o error

### Agente 2: Test Suite Completo
1. Correr TODOS los tests:
   - Backend: `cd backend && python -m pytest tests/ -v`
   - Dashboard: `cd Dashboard && npm run test:run`
   - pwaMenu: `cd pwaMenu && npm run test:run`
   - pwaWaiter: `cd pwaWaiter && npm run test:run`
2. Correr E2E:
   - `cd e2e && npx playwright test`
3. Cobertura:
   - Dashboard: `cd Dashboard && npm run test:coverage`
   - pwaMenu: `cd pwaMenu && npm run test:coverage`
4. Reportar:
   - Tests que fallan
   - Cobertura por componente
   - Flaky tests (si se detectan)

### Agente 3: Release Documentation
1. **Changelog**: generar desde el último tag
   - `git log --oneline {{last_tag}}..HEAD` 
   - Categorizar: features, fixes, breaking changes, docs
2. **RUNBOOK update**: verificar `devOps/RUNBOOK.md`
   - ¿Nuevas variables de entorno?
   - ¿Nuevos servicios en docker-compose?
   - ¿Nuevos health checks?
3. **Migration check**: 
   - Verificar cadena de Alembic completa
   - Identificar migraciones no reversibles
   - Plan de rollback
4. **CLAUDE.md sync**: 
   - Features nuevas documentadas
   - Migration chain actualizada
   - Key decisions reflejadas
5. **Security checklist**:
   - JWT_SECRET configurado en .env prod
   - ALLOWED_ORIGINS correcto
   - COOKIE_SECURE=true
   - DEBUG=false

### Fase Final — Go/No-Go Report

Consolidar los 3 reportes en un único documento:

```markdown
# Release {{VERSION}} — Go/No-Go Report

## Status: 🟢 GO / 🟡 GO CON WARNINGS / 🔴 NO GO

## Build
- [ ] Backend: ✅/❌
- [ ] Dashboard: ✅/❌
- [ ] pwaMenu: ✅/❌
- [ ] pwaWaiter: ✅/❌
- [ ] Docker: ✅/❌

## Tests
- [ ] Backend tests: X/Y passed
- [ ] Dashboard tests: X/Y passed
- [ ] pwaMenu tests: X/Y passed
- [ ] pwaWaiter tests: X/Y passed
- [ ] E2E: X/Y passed

## Coverage
- Dashboard: X%
- pwaMenu: X%
- Backend: no-coverage-tracked

## Changelog
{{changelog aquí}}

## Migrations
- Chain: 001 → 0XX
- Nuevas: ...
- Rollback safe: ✅/❌

## Security
- [ ] JWT_SECRET configured
- [ ] ALLOWED_ORIGINS production
- [ ] COOKIE_SECURE=true
- [ ] DEBUG=false

## Riesgos identificados
...

## Deploy command
cd devOps
git checkout {{BRANCH}}
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
cd ../backend && alembic upgrade head
```

Guardar con: `mem_save title:"Release {{VERSION}} ready" type:decision project:integrador topic_key:release/{{VERSION}}`

## Salida esperada
- Reporte Go/No-Go
- Comandos exactos de deploy
- Plan de rollback
```

> **Nota**: Reemplazar `{PROJECT_ROOT}` con el path real del proyecto (ej: `E:\ESCRITORIO\programar\2026\jr2`)
