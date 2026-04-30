# Playbook 3: Auditoría Semanal

## Cuándo usar
Review periódico del proyecto para detectar regresiones, deuda técnica, gaps de seguridad, etc.

## Frecuencia recomendada
Semanal o antes de cada release.

## Prompt

```
Auditoría semanal del proyecto Integrador.

**Proyecto:** {PROJECT_ROOT}

**Estrategia: 4 agentes en paralelo, después consolidación**

### Agente 1: Security Audit
Revisar:
1. **SQL Injection**: grep de f-strings en queries, `text()` con interpolación
2. **Race conditions**: `with_for_update(skip_locked=True)` en lugares inapropiados, reads-then-writes sin lock
3. **Auth gaps**: endpoints sin `Depends(current_user)` en routers admin/waiter/kitchen
4. **Tenant leaks**: queries sin filtro `tenant_id`
5. **Hardcoded secrets**: grep de `secret`, `password`, `api_key` en source (excluir .env)
6. **CORS**: `ALLOWED_ORIGINS` en producción
7. **Rate limiting**: endpoints críticos sin rate limit

Reportar severidad: CRITICAL, HIGH, MEDIUM con archivo:línea.

### Agente 2: Code Quality Audit
Revisar:
1. **console.log en frontends**: debe ser 0 (usar logger)
2. **TypeScript any**: debe ser 0 en source
3. **TODOs/FIXMEs**: todos los markers de deuda
4. **Destructuring de Zustand**: `const { x } = useStore()` — anti-patrón
5. **useEffect sin cleanup**: subscripciones, intervals sin return
6. **Tests coverage por store**:
   - Dashboard: debe ser 25/25
   - pwaMenu: debe ser 5/7 o más
   - pwaWaiter: debe ser 4/4
7. **Module-level hardcoded strings** en lugar de factory functions con `t()`

Reportar conteo por frontend.

### Agente 3: Architecture Audit
Revisar:
1. **Clean Architecture compliance**: routers con lógica de negocio (debería estar en service)
2. **N+1 queries**: loops con `db.query`, falta de `selectinload`
3. **Soft delete consistency**: queries sin `.is_active.is_(True)`
4. **Event delivery**: eventos críticos en Outbox, no-críticos en Redis directo
5. **FSM consistency**: transiciones de estado usando `validate_round_transition()` centralizado
6. **Feature flags / scaffolds**: módulos marcados como incompletos

Reportar desviaciones con fix sugerido.

### Agente 4: Documentation Sync
Revisar:
1. **CLAUDE.md**: ¿refleja el estado actual?
2. **knowledge-base v4**: ¿archivos desactualizados?
3. **knowledge-base/01-negocio/04_reglas_de_negocio.md**: ¿reglas nuevas no documentadas?
4. **Migration chain**: ¿`04-infraestructura/04_migraciones.md` tiene todas?
5. **Feature maturity**: `06-estado-del-proyecto/02_madurez_y_dependencias.md` actualizado
6. **Salud técnica**: `06-estado-del-proyecto/03_salud_tecnica.md` sin items resueltos

Reportar archivos desactualizados con secciones específicas.

### Fase Final — Consolidación

Consolidar los 4 reportes en un único documento con:
- **Resumen ejecutivo**: top 10 items por severidad
- **Acciones inmediatas**: items CRITICAL que bloquean producción
- **Backlog**: items HIGH/MEDIUM para el próximo sprint
- **Stats**: cobertura de tests, líneas de código, conteo de issues por categoría
- **Trend**: comparar con auditoría anterior (consultar engram: `mem_search query:"audit" project:integrador`)

Guardar el reporte consolidado con:
`mem_save title:"Weekly audit {{fecha}}" type:discovery project:integrador topic_key:audit/{{fecha}}`

## Salida esperada
- Reporte consolidado en markdown
- Lista priorizada de acciones
- Entrada en engram para tracking
```

> **Nota**: Reemplazar `{PROJECT_ROOT}` con el path real del proyecto (ej: `E:\ESCRITORIO\programar\2026\jr2`)
