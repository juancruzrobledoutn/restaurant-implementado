## Architecture

### Data flow

```
MainLayout (mount)
  → fetchBranches(user.branchIds: number[])
    → branchAPI.getBranches()  [GET /api/public/branches, skipAuth=true]
    → filter client-side by userBranchIds
    → if 1 branch & nothing selected → auto-select
    → set branches + selectedBranch + selectedBranchId in store

BranchSwitcher (Navbar)
  ← reads branches, selectedBranch, isLoading from branchStore
  → if isLoading: render skeleton
  → if branches.length === 1: SingleBranchDisplay (static, no dropdown)
  → else: BranchDropdown (listbox, outside-click close via document mousedown)

setSelectedBranch(branch)
  → update selectedBranch + selectedBranchId
  → if previousBranch !== null (branch SWITCH, not first selection):
      useTableStore.getState().clearAll()
      useSalesStore.getState().reset()
```

### Store persist strategy

Only `selectedBranchId` is persisted (string, backward-compatible with C-15 stub).
`branches` is NOT persisted — always fetched fresh on mount (list may change).
`selectedBranch` is NOT persisted — rehydrated from `branches` + `selectedBranchId` in `fetchBranches`.

### ID convention

Backend → `id: number`. Frontend `Branch.id` stays `number`.
`selectedBranchId` in store is `string` (for DOM/localStorage compat).
Conversion: `String(branch.id)` in `setSelectedBranch`.

### Circular import avoidance

`branchStore` imports `tableStore` and `salesStore` statically — no circular dependency
because neither `tableStore` nor `salesStore` import from `branchStore`.
`authStore` still uses dynamic `import()` for `branchStore` on logout (existing C-15 pattern).

## Component design

### BranchSwitcher

```
BranchSwitcher
├── isLoading → <BranchSwitcherSkeleton> (animate-pulse)
├── branches.length === 1 → <SingleBranchDisplay> (static button, no interaction)
└── branches.length !== 1 → <BranchDropdown>
    ├── Trigger: Building2 icon + name/placeholder + ChevronDown
    ├── isOpen state (local useState)
    ├── useRef + document mousedown listener for outside-click
    └── ul[role=listbox] → li[role=option] per branch
```

### Styling

- Navbar bg: `bg-gray-900` → components use `text-white`, `hover:bg-gray-700`, `border-gray-700`
- Active branch in dropdown: `bg-orange-600/20 text-orange-400` (orange theme)
- Dropdown positioned: `absolute left-1/2 -translate-x-1/2 top-full mt-1`
- Shadow: `shadow-lg shadow-black/40` (dark UI)

## Key decisions

- **D1 — Client-side filter**: The public endpoint returns ALL branches of the tenant. We filter by `user.branchIds` in the frontend. Rationale: avoids a new authenticated endpoint; public endpoint is already safe (only exposes name/address/slug).
- **D2 — Static imports for clearAll/reset**: Using static imports (not dynamic `import()`) for tableStore and salesStore inside branchStore, since there's no circular dependency. This makes the behavior synchronous and testable with vitest mocks.
- **D3 — No persist for `branches`**: Branch list is always fresh — persisting it risks stale data after admin adds/removes branches.
- **D4 — Auto-select only on first load**: Auto-select fires only when `selectedBranch === null` after filtering. If the user already has a selection (persisted), we rehydrate it instead.
- **D5 — clearAll only on branch SWITCH**: Clearing stores on first selection (null → branch) would wipe any pre-loaded data unnecessarily. Guard: `previousBranch !== null`.

## Files affected

| File | Action | Notes |
|------|--------|-------|
| `src/types/branch.ts` | New | `Branch` interface (id: number) |
| `src/services/branchAPI.ts` | New | `getBranches()` with `skipAuth: true` |
| `src/stores/branchStore.ts` | Expanded | `branches`, `selectedBranch`, `fetchBranches`, `setSelectedBranch` |
| `src/stores/tableStore.ts` | Modified | Added `clearAll()` action |
| `src/components/layout/BranchSwitcher.tsx` | New | Skeleton / Single / Multi states |
| `src/components/layout/Navbar.tsx` | Modified | Spacer → `<BranchSwitcher />` centered |
| `src/components/layout/MainLayout.tsx` | Modified | `fetchBranches` on mount with `user.branchIds` |
