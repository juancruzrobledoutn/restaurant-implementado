---
name: zustand-store-pattern
description: >
  Enforces correct Zustand 5 patterns for all frontend stores in the Integrador restaurant system.
  Trigger: When creating or modifying any Zustand store in Dashboard, pwaMenu, or pwaWaiter.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Creating a new Zustand store in any frontend (Dashboard, pwaMenu, pwaWaiter)
- Adding selectors or modifying existing store selectors
- Consuming store state in any React component
- Adding `persist()` middleware to a store
- Refactoring a store to modular structure

---

## Critical Patterns

### 1. NEVER destructure from store — causes infinite re-renders

```typescript
// FORBIDDEN — new object reference on every render = infinite loop
const { items } = useStore()

// REQUIRED — subscribe to a single value via selector
const items = useStore(selectItems)
const addItem = useStore((s) => s.addItem)
```

### 2. useShallow is MANDATORY for object/array selectors

Use `useShallow` when the selector returns an object literal or a filtered/mapped array.
Without it, Zustand creates a new reference each render, causing an infinite loop.

```typescript
import { useShallow } from 'zustand/react/shallow'

// REQUIRED — grouped actions as object
export const useCartActions = () =>
  useStore(
    useShallow((state) => ({
      addItem: state.addItem,
      removeItem: state.removeItem,
      clearCart: state.clearCart,
    }))
  )

// REQUIRED — filtered array inside selector
const staff = useStaffStore(
  useShallow((state) =>
    selectedBranchId ? state.staff.filter((s) => s.branch_id === selectedBranchId) : []
  )
)
```

**Decision table:**

| Selector returns | Use |
|-----------------|-----|
| Primitive (string, number, boolean) | Plain selector |
| Single state slice (array already in state) | Plain selector |
| Object literal `{ a, b, c }` | `useShallow` |
| Filtered/mapped array | `useShallow` OR `useMemo` |
| Derived numeric value (reduce) | Plain selector (returns primitive) |

### 3. useMemo for derived values already extracted from state

When you already have a stable state slice and need to derive from it, use `useMemo` in the component or composite selector — NOT inside a plain selector.

```typescript
// CORRECT — derive inside hook with useMemo
export const useOrderHistoryData = () => {
  const orders = useStore((state) => state.orders)

  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === 'pending'),
    [orders]
  )

  return { orders, pendingOrders }
}

// WRONG — filter inside plain selector creates new reference
const pendingOrders = useStore((state) => state.orders.filter(...))
```

### 4. Stable EMPTY_ARRAY references for nullable fallbacks

Never inline `?? []` inside a selector — each call creates a new array reference.
Declare module-level constants and reuse them.

```typescript
// At module top level (store.ts or selectors.ts)
const EMPTY_CART_ITEMS: CartItem[] = []
const EMPTY_DINERS: Diner[] = []

// CORRECT — stable reference
export const useCartItems = () =>
  useStore((state) => state.session?.sharedCart ?? EMPTY_CART_ITEMS)

// WRONG — new [] on every render
export const useCartItems = () =>
  useStore((state) => state.session?.sharedCart ?? [])
```

### 5. persist() with versioning

All persisted stores MUST use a version from the shared `STORE_VERSIONS` constant.
Increment version and add a `migrate` function whenever the data shape changes.

```typescript
import { STORAGE_KEYS, STORE_VERSIONS } from '../utils/constants'

export const useMyStore = create<MyState>()(
  persist(
    (set, get) => ({ ... }),
    {
      name: STORAGE_KEYS.MY_STORE,
      version: STORE_VERSIONS.MY_STORE,
      migrate: (persistedState: unknown, version: number) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { items: [] }
        }
        const state = persistedState as { items?: unknown }
        if (!Array.isArray(state.items)) {
          return { items: [] }
        }
        let items = state.items
        if (version < 2) {
          items = items.map((i) => ({ ...i, newField: i.newField ?? defaultValue }))
        }
        return { items } as MyState
      },
    }
  )
)
```

**Migration type safety rules:**
- Parameter type is always `unknown` — never `any`
- Add type guard before casting
- Return early with safe defaults on validation failure
- Cast return value to `State` type

---

## File Organization

### Simple store (flat, few selectors)

Place selectors directly in the same file as the store:

```
src/stores/
└── myStore.ts        # create(), selectors, types all in one file
```

### Complex store (modular structure)

When the store has many actions, computed selectors, or domain complexity — split into a folder.
Reference: `pwaMenu/src/stores/tableStore/`

```
src/stores/myStore/
├── store.ts          # create() call only — no selectors exported from here
├── selectors.ts      # All selector hooks — import useMyStore from ./store
├── helpers.ts        # Pure utility functions (no React, no Zustand imports)
└── types.ts          # TypeScript interfaces for state, actions, and domain types
```

**store.ts** — only the store definition:
```typescript
export const useMyStore = create<MyState>()(
  persist((set, get) => ({ ... }), { name: ..., version: ... })
)
```

**selectors.ts** — all hooks that consume the store:
```typescript
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useMyStore } from './store'

const EMPTY_ITEMS: Item[] = []

export const useItems = () => useMyStore((s) => s.items ?? EMPTY_ITEMS)
export const useItemActions = () => useMyStore(useShallow((s) => ({ add: s.add, remove: s.remove })))
```

**helpers.ts** — pure functions, no side effects:
```typescript
// No React imports, no Zustand imports
export function calculateTotal(items: Item[]): number { ... }
export function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> { ... }
```

**types.ts** — all interfaces:
```typescript
export interface MyState {
  items: Item[]
  isLoading: boolean
  // actions
  addItem: (item: Item) => void
  removeItem: (id: string) => void
}
```

---

## Store Definition Template

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '../utils/constants'

interface MyState {
  items: Item[]
  isLoading: boolean
  addItem: (item: Item) => void
  removeItem: (id: string) => void
  reset: () => void
}

// Stable fallback
const EMPTY_ITEMS: Item[] = []

export const useMyStore = create<MyState>()(
  persist(
    (set, get) => ({
      items: EMPTY_ITEMS,
      isLoading: false,

      addItem: (item) => set((state) => ({ items: [...state.items, item] })),

      removeItem: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

      reset: () => set({ items: EMPTY_ITEMS, isLoading: false }),
    }),
    {
      name: STORAGE_KEYS.MY_STORE,
      version: STORE_VERSIONS.MY_STORE,
    }
  )
)

// Selectors — export from same file for simple stores
export const selectItems = (s: MyState) => s.items
export const selectIsLoading = (s: MyState) => s.isLoading
```

---

## Component Usage Template

```typescript
import { useMyStore, selectItems } from '../stores/myStore'
import { useShallow } from 'zustand/react/shallow'

function MyComponent() {
  // Single value — plain selector
  const items = useMyStore(selectItems)
  const isLoading = useMyStore((s) => s.isLoading)

  // Single action — inline selector
  const addItem = useMyStore((s) => s.addItem)

  // Multiple actions — useShallow
  const { addItem, removeItem } = useMyStore(
    useShallow((s) => ({ addItem: s.addItem, removeItem: s.removeItem }))
  )

  // Filtered list — useShallow
  const activeItems = useMyStore(
    useShallow((s) => s.items.filter((i) => i.is_active))
  )

  // Derived value from stable slice — useMemo
  const total = useMemo(
    () => items.reduce((sum, i) => sum + i.price, 0),
    [items]
  )
}
```

---

## Checklist Before Committing

- [ ] No `const { x } = useStore()` destructuring anywhere
- [ ] Object-returning selectors use `useShallow`
- [ ] Filtered/mapped arrays use `useShallow` or `useMemo`
- [ ] Nullable array fallbacks use module-level `EMPTY_*` constants, not inline `?? []`
- [ ] Persisted stores have `version` set from `STORE_VERSIONS`
- [ ] `migrate` function uses `unknown` type, not `any`
- [ ] Complex stores use modular folder structure
- [ ] `helpers.ts` has no React or Zustand imports (pure functions only)

---

## Resources

- **Reference implementation**: `pwaMenu/src/stores/tableStore/` — canonical modular store example
- **Constants**: `Dashboard/src/utils/constants.ts` — `STORE_VERSIONS`, `STORAGE_KEYS`
- **Global pattern docs**: Root `CLAUDE.md` — "Critical Zustand Pattern" section
