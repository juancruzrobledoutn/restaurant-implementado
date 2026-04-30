---
name: ws-frontend-subscription
description: >
  Patterns for subscribing React components to WebSocket events in Dashboard, pwaMenu, and pwaWaiter.
  Trigger: When connecting any React component or Zustand store to WebSocket events via wsService.on(), dashboardWS.on(), or any ws*.on() call in the frontend.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
allowed-tools: Read, Edit, Write, Glob, Grep
---

## When to Use

- Adding a new component that needs to react to real-time WebSocket events
- Adding a new `useEffect` that calls `ws.on(...)` or `wsService.on(...)`
- Reviewing or refactoring existing WS subscriptions in any frontend sub-project
- Connecting a Zustand store action to a WS event listener inside a React component

---

## Critical Patterns

### 1. The Ref Pattern (MANDATORY — prevents listener accumulation)

Every WS subscription in a React component MUST follow this two-effect structure:

```typescript
import { useRef, useEffect } from 'react'
import { wsService } from '../services/websocket'   // pwaWaiter / pwaMenu
// import { dashboardWS } from '../services/websocket'  // Dashboard

function MyComponent() {
  const handleEvent = (event: WSEvent) => {
    // Use fresh props/state here — ref keeps this up-to-date
    if (event.type === 'TABLE_SESSION_STARTED') {
      doSomething(event)
    }
  }

  // Effect 1: sync the ref on EVERY render (no deps needed — intentional)
  const handleEventRef = useRef(handleEvent)
  useEffect(() => {
    handleEventRef.current = handleEvent
  })

  // Effect 2: subscribe ONCE — empty deps array is correct here
  useEffect(() => {
    const unsubscribe = wsService.on('*', (e) => handleEventRef.current(e))
    return unsubscribe  // Cleanup on unmount
  }, [])

  return <div>...</div>
}
```

**Why two effects?**
- Effect 1 (no deps) runs after every render and updates the ref to point at the latest version of `handleEvent` — which closes over the latest props and state.
- Effect 2 (empty deps) subscribes exactly once. It calls `handleEventRef.current` so it always invokes the latest handler without ever re-subscribing.

Without this pattern, adding `handleEvent` to Effect 2's deps causes a new subscription on every render → listener accumulation → duplicate event processing and memory leaks.

---

### 2. Subscribe to Specific Event Types

Prefer subscribing to a specific event type over `'*'` when the component only cares about one event. This reduces unnecessary callback invocations:

```typescript
useEffect(() => {
  const unsubscribe = wsService.on('ROUND_READY', (e) => handleEventRef.current(e))
  return unsubscribe
}, [])
```

When the component needs to handle multiple but not all events, use `'*'` and filter inside the handler:

```typescript
const handleEvent = (event: WSEvent) => {
  switch (event.type) {
    case 'TABLE_SESSION_STARTED':
      handleTableStart(event)
      break
    case 'TABLE_CLEARED':
      handleTableClear(event)
      break
    // Ignore all other event types
  }
}
```

---

### 3. Branch Filtering (Dashboard — multi-branch context)

In Dashboard, always filter events by `branch_id` to avoid processing events from other branches. Use the built-in `onFiltered` or `onFilteredMultiple` methods instead of doing it manually:

```typescript
// Single branch
useEffect(() => {
  const unsubscribe = dashboardWS.onFiltered(
    selectedBranchId,
    '*',
    (e) => handleEventRef.current(e)
  )
  return unsubscribe
}, [selectedBranchId])  // Re-subscribe when branch changes — this is the ONLY valid non-empty deps case

// Multiple branches
useEffect(() => {
  const unsubscribe = dashboardWS.onFilteredMultiple(
    branchIds,
    'ENTITY_UPDATED',
    (e) => handleEventRef.current(e)
  )
  return unsubscribe
}, [branchIds])
```

Note: when `selectedBranchId` is in deps, `useShallow` or a stable reference is required to prevent infinite loops if it comes from a Zustand selector that returns a new array.

---

### 4. Throttled Subscriptions (high-traffic event types)

For event types that fire rapidly (e.g., `ROUND_*` during busy service), use `onThrottled` to prevent excessive re-renders:

```typescript
// pwaWaiter
useEffect(() => {
  const unsubscribe = wsService.onThrottled(
    'ROUND_IN_KITCHEN',
    (e) => handleEventRef.current(e),
    100  // ms — default is 100, can be omitted
  )
  return unsubscribe
}, [])

// Dashboard (with filtering + throttling combined)
useEffect(() => {
  const unsubscribe = dashboardWS.onFilteredThrottled(
    branchId,
    '*',
    (e) => handleEventRef.current(e),
    100
  )
  return unsubscribe
}, [branchId])
```

---

### 5. Token Refresh Before WS Connection (pwaWaiter)

pwaWaiter proactively refreshes the JWT every 14 minutes to prevent the WS connection from dropping mid-session. The auth store handles this automatically via `authStore.ts`. When initializing the WS connection, register the refresh callback:

```typescript
// In the component or store that initializes the connection:
wsService.setTokenRefreshCallback(async () => {
  const newToken = await authAPI.refresh()
  return newToken
})
await wsService.connect(token)
```

The service parses the JWT expiration, schedules a refresh 1 minute before expiry, and calls `updateToken()` which does a clean reconnect preserving all existing listeners.

**Token lifetime:** Access token = 15 min | Refresh token = 7 days (HttpOnly cookie)
**WS heartbeat:** Client pings every 30s (`{"type":"ping"}`), server responds `{"type":"pong"}`. If no pong within 10s, the connection is force-closed and reconnect is triggered. Server timeout is 60s.

---

### 6. Connection State Subscription

To react to connect/disconnect events (e.g., show an offline banner), use `onConnectionChange`:

```typescript
useEffect(() => {
  const unsubscribe = wsService.onConnectionChange((isConnected) => {
    setIsOnline(isConnected)
  })
  return unsubscribe  // Cleanup removes from connectionStateListeners Set
}, [])
```

This also immediately notifies with the current connection state on subscribe.

---

### 7. Async Mount Guard (when WS event triggers an async operation)

If the event handler kicks off an async fetch, guard against setting state after unmount:

```typescript
const handleEvent = useCallback((event: WSEvent) => {
  let isMounted = true

  fetchAdditionalData(event.entity?.round_id).then((data) => {
    if (!isMounted) return
    setExtraData(data)
  })

  // Note: isMounted cleanup must be in a separate effect, not inside the handler.
  // Prefer synchronous handlers that dispatch to Zustand actions instead.
}, [])
```

**Preferred alternative:** dispatch to a Zustand store action and let the store handle async state. Keeps components thin and avoids the mount-guard complexity entirely.

---

## Anti-Patterns (NEVER do these)

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `useEffect(() => { ws.on(...handler) }, [handler])` | Re-subscribes on every render → listener accumulation | Use ref pattern — subscribe once with `[]` deps |
| `useEffect(() => { ws.on(...) })` (no return) | Listener is never removed → memory leak on unmount | Always `return unsubscribe` |
| `useEffect(() => { ws.on('*', handler); ws.on('ROUND_READY', handler) }, [])` | Duplicate calls → handler fires twice for matching events | Subscribe once to `'*'` and filter, or subscribe once per event type |
| Calling `ws.on()` outside `useEffect` (at render time) | Subscribes on every render without cleanup | Always wrap in `useEffect` |
| Forgetting `return unsubscribe` when `selectedBranchId` is in deps | Old branch listener leaks when branch changes | `return unsubscribe` runs cleanup before re-subscribing |

---

## Service API Quick Reference

Both `wsService` (pwaWaiter/pwaMenu) and `dashboardWS` (Dashboard) share the same interface:

| Method | Signature | When to use |
|---|---|---|
| `on` | `(type \| '*', cb) => unsubscribe` | Single event or all events |
| `onFiltered` | `(branchId, type \| '*', cb) => unsubscribe` | Dashboard: filter by branch |
| `onFilteredMultiple` | `(branchIds[], type \| '*', cb) => unsubscribe` | Dashboard: multi-branch |
| `onThrottled` | `(type \| '*', cb, delayMs?) => unsubscribe` | High-frequency events |
| `onFilteredThrottled` | `(branchId, type \| '*', cb, delayMs?) => unsubscribe` | Dashboard: filtered + throttled |
| `onConnectionChange` | `(cb: (isConnected) => void) => unsubscribe` | Offline/online banner |
| `onMaxReconnect` | `(cb: () => void) => unsubscribe` | Show "reconnection failed" UI |

All methods return a cleanup function — always assign it and return it from `useEffect`.

---

## Service Locations

| Sub-project | Service instance | File |
|---|---|---|
| pwaWaiter | `wsService` | `pwaWaiter/src/services/websocket.ts` |
| pwaMenu | `wsService` (same pattern) | `pwaMenu/src/services/websocket.ts` |
| Dashboard | `dashboardWS` | `Dashboard/src/services/websocket.ts` |

> ⚠️ **Nota**: Los archivos de servicio WebSocket se crean en C-14 (dashboard-shell) y C-17 (pwaMenu-shell).

---

## References

- **WebSocket service (pwaWaiter)**: `pwaWaiter/src/services/websocket.ts`
- **WebSocket service (Dashboard)**: `Dashboard/src/services/websocket.ts`
- **Real subscription example**: `pwaWaiter/src/stores/tablesStore.ts` (store-level WS handlers)
- **Auth + token refresh**: `pwaWaiter/src/stores/authStore.ts`
- **Event types (pwaWaiter)**: `pwaWaiter/src/types/index.ts`
- **Event types (Dashboard)**: `Dashboard/src/services/websocket.ts` (`WSEventType` export)
- **Close codes**: 4001 (auth failed — no retry), 4003 (forbidden — no retry), 4029 (rate limited — no retry)
