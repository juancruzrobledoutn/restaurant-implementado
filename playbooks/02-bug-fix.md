# Playbook 2: Bug Fix Cross-Capa

## Cuándo usar
Cuando hay un bug que toca múltiples capas (backend + frontend, o múltiples frontends).

## Variables a reemplazar
- `{{BUG_DESCRIPTION}}`: descripción del bug
- `{{REPRODUCTION}}`: cómo reproducir
- `{{EXPECTED}}`: comportamiento esperado
- `{{ACTUAL}}`: comportamiento actual

## Prompt

```
Necesito investigar y fixear un bug cross-capa en el monorepo Integrador.

**Bug:**
{{BUG_DESCRIPTION}}

**Reproducción:**
{{REPRODUCTION}}

**Esperado:** {{EXPECTED}}
**Actual:** {{ACTUAL}}

**Proyecto:** {PROJECT_ROOT}

**Estrategia: 2 agentes en paralelo, después 1 coordinador**

### Fase 1 — PARALELO: Investigación

**Agente Investigator Backend:**
- Buscar en `backend/` el código relacionado al bug
- Identificar qué endpoints, servicios, modelos están involucrados
- Revisar logs relevantes si existen
- Consultar engram: `mem_search query:"{{BUG_DESCRIPTION}}" project:integrador`
- Reportar:
  - Archivos sospechosos con línea exacta
  - Hipótesis de causa raíz
  - Qué tests existen para esta área

**Agente Investigator Frontend:**
- Buscar en Dashboard/pwaMenu/pwaWaiter el código relacionado
- Identificar componentes, stores, API calls involucrados
- Revisar si hay console.log o logger que podría estar capturando el bug
- Reportar:
  - Archivos sospechosos con línea exacta
  - Hipótesis de causa raíz
  - Cómo se manifiesta en UI

### Fase 2 — Análisis (esperar a que Fase 1 termine)

Con los 2 reportes:
1. Consolidar la causa raíz real
2. Determinar el scope del fix (¿solo backend? ¿solo frontend? ¿ambos?)
3. Identificar riesgo de regresión (¿qué otros flujos tocan el mismo código?)

### Fase 3 — PARALELO: Fix + Test

**Agente Fixer:**
- Implementar el fix mínimo y dirigido
- NO refactorizar código aledaño
- Aplicar en TODOS los lugares afectados (backend + frontends si aplica)
- Seguir las convenciones del proyecto
- Agregar logger.error/warn donde corresponda (no console.log)

**Agente Tester:**
- Escribir tests de regresión que fallen SIN el fix
- Backend: pytest en `backend/tests/`
- Frontend: vitest en el store o componente afectado
- E2E si el bug es cross-capa crítico
- Los tests deben ser independientes y reproducibles

### Fase 4 — Documentación

1. Si el bug revela una falla arquitectónica → actualizar `knowledge-base/06-estado-del-proyecto/06_inconsistencias.md`
2. Si es una convención nueva → agregar a `knowledge-base/05-dx/03_trampas_conocidas.md`
3. Guardar en engram con `mem_save type:bugfix topic_key:bugfix/{{short_description}}`

## Reglas críticas
- NO introducir comportamientos nuevos aparte del fix
- Los tests deben fallar SIN el fix y pasar CON el fix
- Si el fix requiere cambio de schema → crear migración
- Si el fix afecta eventos WebSocket → actualizar KB de eventos

## Salida esperada
- Análisis de causa raíz
- Diff de archivos modificados
- Tests de regresión corriendo
- Entrada en engram
```

> **Nota**: Reemplazar `{PROJECT_ROOT}` con el path real del proyecto (ej: `E:\ESCRITORIO\programar\2026\jr2`)
