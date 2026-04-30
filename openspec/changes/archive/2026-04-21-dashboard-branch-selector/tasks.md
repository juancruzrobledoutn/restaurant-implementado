# Tasks — dashboard-branch-selector (C-29)

## Implementation

- [x] Create `Dashboard/src/types/branch.ts` — `Branch` interface (`id: number`, `name`, `address`, `slug`)
- [x] Create `Dashboard/src/services/branchAPI.ts` — `getBranches()` calling `GET /api/public/branches` with `skipAuth: true`
- [x] Expand `Dashboard/src/stores/branchStore.ts` — add `branches`, `selectedBranch`, `fetchBranches(userBranchIds)`, `setSelectedBranch()`, selectors; keep `selectedBranchId` + `setSelectedBranchId` for compat
- [x] Add `clearAll()` to `Dashboard/src/stores/tableStore.ts` — resets `items`, `isLoading`, `error`
- [x] Create `Dashboard/src/components/layout/BranchSwitcher.tsx` — skeleton / single / multi states with accessible listbox
- [x] Modify `Dashboard/src/components/layout/Navbar.tsx` — replace spacer div with `<BranchSwitcher />` centered
- [x] Modify `Dashboard/src/components/layout/MainLayout.tsx` — call `fetchBranches(user.branchIds)` on mount via `useEffect`

## Tests

- [x] `Dashboard/src/stores/branchStore.test.ts` — fetchBranches (filter, loading, error), auto-select (1 branch, N branches, pre-selected), setSelectedBranch (derives selectedBranchId, clears dependent stores on switch, no-clear on first selection)
- [x] `Dashboard/src/stores/tableStore.test.ts` — add `clearAll` test
- [x] `Dashboard/src/components/layout/BranchSwitcher.test.tsx` — no selection placeholder, loading skeleton, single branch display, multi-branch dropdown (open, select, close, outside-click)
- [x] Update `Dashboard/src/components/layout/MainLayout.test.tsx` — add `branchStore` mock to existing tests

## Verification

- [x] All 460 tests pass (`npx vitest run`)
- [x] `selectedBranchId` persist backward-compatible (reads old C-15 persisted value)
- [x] `branches` NOT in persist partialize (always fetched fresh)
- [x] No circular imports (branchStore → tableStore/salesStore is safe; authStore → branchStore via dynamic import preserved)
