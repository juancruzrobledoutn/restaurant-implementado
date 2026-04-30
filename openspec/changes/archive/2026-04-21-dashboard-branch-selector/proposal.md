## Why

El Dashboard carece de un selector de sucursal visible en la UI. Los usuarios con acceso a múltiples sucursales no tienen forma visual de saber cuál sucursal está activa ni de cambiarla sin recargar. Esto bloquea el flujo operativo diario (HU-0303).

## What Changes

- Nuevo servicio `branchAPI.ts`: consume `GET /api/public/branches` (endpoint ya existente) y devuelve `Branch[]`
- Expansión de `branchStore.ts`: agrega `branches: Branch[]`, `selectedBranch: Branch | null`, `fetchBranches(userBranchIds)`, `setSelectedBranch()` — manteniendo compatibilidad con `selectedBranchId` ya persistido
- Nuevo componente `BranchSwitcher.tsx`: dropdown en el Navbar con loading skeleton, modo single (1 sucursal sin dropdown), modo multi (N sucursales con listbox accesible)
- Modificación de `Navbar.tsx`: reemplaza el spacer `<div className="flex-1" />` con `<BranchSwitcher />` centrado
- Modificación de `MainLayout.tsx`: llama `fetchBranches(user.branchIds)` al montar (post-login)
- Adición de `clearAll()` a `tableStore` para limpieza al cambiar de sucursal
- Auto-select: si el usuario tiene una sola sucursal, se selecciona automáticamente

## Capabilities

### New Capabilities

- `branch-switcher`: Selector visual de sucursal en el Navbar del Dashboard — permite a usuarios multi-sucursal cambiar de contexto operativo sin recargar la app

### Modified Capabilities

- `branch-selection`: El store existente (stub de C-15) se expande con la lista completa de sucursales y el objeto seleccionado completo

## Impact

- `Dashboard/src/services/branchAPI.ts` — nuevo
- `Dashboard/src/types/branch.ts` — nuevo
- `Dashboard/src/stores/branchStore.ts` — expandido (retrocompatible)
- `Dashboard/src/stores/tableStore.ts` — agrega `clearAll()`
- `Dashboard/src/components/layout/BranchSwitcher.tsx` — nuevo
- `Dashboard/src/components/layout/Navbar.tsx` — modificado
- `Dashboard/src/components/layout/MainLayout.tsx` — modificado
- Sin cambios en backend (usa endpoint público ya existente)
