# Playbook 5: Refactor Coordinado

## Cuándo usar
Cuando necesitás hacer un cambio atómico en múltiples capas/archivos sin romper funcionalidad. Ejemplo: extraer una base class, renombrar un concepto cross-monorepo, unificar patrones duplicados.

## Variables a reemplazar
- `{{REFACTOR_NAME}}`: nombre descriptivo del refactor
- `{{GOAL}}`: qué querés lograr
- `{{SCOPE}}`: archivos/componentes afectados

## Prompt

```
Necesito hacer un refactor coordinado en el monorepo Integrador.

**Refactor:** {{REFACTOR_NAME}}
**Objetivo:** {{GOAL}}
**Scope:** {{SCOPE}}

**Proyecto:** {PROJECT_ROOT}

**Estrategia: 3 fases con agentes en paralelo**

### Fase 1 — Research (PARALELO, 2 agentes)

**Agente Research Current State:**
- Leer TODOS los archivos en el scope
- Documentar el estado actual: qué hacen, qué patrones usan, qué tienen en común, qué tienen de diferente
- Identificar duplicación exacta vs conceptual
- Contar líneas afectadas
- Mapear importers: qué archivos IMPORTAN los archivos a refactorizar (grep)
- Reportar:
  - Tabla comparativa de diferencias
  - Lista de importers
  - Código compartible vs específico
  - Riesgos de breaking changes

**Agente Research Patterns:**
- Buscar en la KB (`knowledge-base/02-arquitectura/`) si ya existe un patrón que apliquemos
- Consultar engram: `mem_search query:"{{REFACTOR_NAME}}" project:integrador`
- Revisar patrones similares en el código para consistencia
- Proponer 2-3 approaches con tradeoffs
- Reportar:
  - Approach recomendado con justificación
  - Approaches alternativos con tradeoffs
  - Referencias a patrones existentes

### Fase 2 — Plan (1 agente coordinador)

Con los 2 reportes de Fase 1:
1. Decidir el approach final
2. Armar plan de ejecución con orden exacto:
   - Qué crear primero (nuevas abstracciones)
   - Qué modificar después (consumidores)
   - Qué eliminar al final (código viejo)
3. Identificar puntos de verificación: ¿después de qué paso deben correr los tests?
4. Listar archivos EXACTOS a tocar con la acción (crear, modificar, eliminar)
5. Estimar líneas antes/después

**SI el usuario no está presente**, pausar y pedir aprobación del plan antes de ejecutar.

### Fase 3 — Execution (PARALELO, hasta 5 agentes según scope)

Dividir el trabajo por componente o por capa, SIN DEPENDENCIAS cruzadas:

**Si el refactor es cross-frontend:**
- Agente Base: crea la abstracción compartida en `shared/`
- Agente Dashboard: adapta Dashboard para usar la abstracción
- Agente pwaMenu: adapta pwaMenu
- Agente pwaWaiter: adapta pwaWaiter
- Agente QA: corre tests después de cada adaptación

**Si el refactor es backend:**
- Agente Service: refactoriza services
- Agente Router: adapta routers
- Agente Tests: actualiza tests
- Agente Docs: actualiza KB y CLAUDE.md

Cada agente DEBE:
1. Leer los archivos afectados primero
2. Hacer cambios MÍNIMOS que preserven comportamiento
3. Reportar cada archivo tocado con diff summary
4. NO modificar archivos fuera de su scope asignado
5. Si encuentra algo inesperado, DETENERSE y reportar

### Fase 4 — Validation

Después de que todos los agentes terminen:
1. Correr tests del componente afectado
2. Verificar que la API pública no cambió (si es una lib compartida)
3. Grep de referencias al código viejo — debe ser 0
4. Contar líneas totales antes/después
5. Guardar en engram:
   ```
   mem_save 
     title:"Refactor {{REFACTOR_NAME}} complete"
     type:architecture
     topic_key:refactor/{{refactor-slug}}
     project:integrador
     content:"**What**: ... **Where**: ... **Learned**: ..."
   ```

## Reglas críticas

- **NO mezclar refactor con features nuevas**: si encontrás un bug durante el refactor, anotarlo pero NO fixearlo en el mismo cambio
- **Preservar API pública**: consumidores externos no deben necesitar cambios
- **Commits atómicos**: el refactor debe dejar el código siempre compilando (si se usa VCS)
- **Tests deben seguir pasando**: si un test falla después del refactor, es porque se rompió funcionalidad — no "actualizar el test para que pase"
- **Rollback plan**: documentar cómo revertir si algo sale mal

## Salida esperada

- Reporte de research con approach elegido
- Plan ejecutable con orden exacto
- Diff summary por archivo
- Stats: líneas antes/después, archivos tocados
- Tests verdes
- Entrada en engram
```

> **Nota**: Reemplazar `{PROJECT_ROOT}` con el path real del proyecto (ej: `E:\ESCRITORIO\programar\2026\jr2`)
