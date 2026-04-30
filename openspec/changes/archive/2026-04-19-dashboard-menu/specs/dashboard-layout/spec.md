# dashboard-layout Delta Spec

> Change: **C-15 dashboard-menu**. Extends the Dashboard MainLayout with the Menu sidebar section, the WebSocket sync hook mount, and the global toast container.

## ADDED Requirements

### Requirement: MainLayout mounts useMenuWebSocketSync

The Dashboard `MainLayout` SHALL mount the `useMenuWebSocketSync()` hook exactly once when the user is authenticated. Mounting SHALL happen inside the MainLayout component so it is active for all protected routes and unmounts on logout. The hook SHALL NOT be mounted in individual pages.

#### Scenario: Hook mounted on authenticated layout
- **WHEN** the user is authenticated and MainLayout renders
- **THEN** `useMenuWebSocketSync()` SHALL be invoked and establish a subscription to `dashboardWS.onFiltered(selectedBranchId, '*', ...)`

#### Scenario: Hook unmounts on logout
- **WHEN** the user logs out and MainLayout unmounts
- **THEN** the WebSocket subscription SHALL be cleaned up via its returned `unsubscribe` function

### Requirement: MainLayout renders ToastContainer

The Dashboard `MainLayout` SHALL render a single `<ToastContainer>` component in a fixed position (top-right of the viewport). The container SHALL subscribe to `toastStore` via `useToastStore(selectToasts)` and render each toast with the correct ARIA attributes. Individual pages SHALL NOT render their own `<ToastContainer>`.

#### Scenario: Only one ToastContainer in the DOM
- **WHEN** MainLayout is rendered
- **THEN** exactly one `<ToastContainer>` SHALL exist in the document

#### Scenario: Toasts render with accessible attributes
- **WHEN** `toast.error('...')` fires
- **THEN** the rendered toast element SHALL have `role="alert"` and `aria-live="assertive"`

## MODIFIED Requirements

### Requirement: Collapsible sidebar with icon-only mode

The sidebar SHALL support two states: expanded (shows icons + text labels) and collapsed (shows icons only). The collapse state SHALL be toggled via a button in the sidebar. The collapsed/expanded state SHALL persist in `localStorage` under key `sidebar-collapsed`. On screens narrower than 768px, the sidebar SHALL be hidden by default and toggled via a hamburger button in the navbar. The sidebar SHALL organize navigation items in labeled groups: `Inicio` (single item), `Menu` (6 items: Categories, Subcategories, Products, Allergens, Ingredients, Recipes), and placeholder slots for future groups (`Operaciones`, `Ajustes`). Each item SHALL include a lucide-react icon and a translated label via `t('layout.sidebar.<key>')`. The Menu group header SHALL display the translated `layout.sidebar.menu.groupLabel` when the sidebar is expanded, and SHALL collapse to a divider with a tooltip on hover when the sidebar is collapsed. The active route's sidebar item SHALL have `aria-current="page"`.

#### Scenario: Sidebar starts in persisted state
- **WHEN** the Dashboard loads and `localStorage` has `sidebar-collapsed: "true"`
- **THEN** the sidebar SHALL render in collapsed (icon-only) mode

#### Scenario: Sidebar toggles between expanded and collapsed
- **WHEN** the user clicks the collapse/expand toggle button
- **THEN** the sidebar SHALL transition to the opposite state and persist the new state to `localStorage`

#### Scenario: Sidebar is hidden on mobile by default
- **WHEN** the viewport width is less than 768px
- **THEN** the sidebar SHALL be hidden and a hamburger menu button SHALL appear in the navbar

#### Scenario: Hamburger opens sidebar overlay on mobile
- **WHEN** the hamburger button is clicked on mobile
- **THEN** the sidebar SHALL appear as an overlay and clicking outside it SHALL close it

#### Scenario: Menu section renders six items
- **WHEN** the sidebar is in expanded mode for an authenticated user
- **THEN** the Menu group SHALL render six navigation items (Categories, Subcategories, Products, Allergens, Ingredients, Recipes), each with a lucide-react icon and translated label

#### Scenario: Active Menu route highlighted
- **WHEN** the user is on `/products`
- **THEN** the "Products" sidebar item SHALL have `aria-current="page"` and the active visual state

### Requirement: React Router v7 with lazy-loaded pages

The Dashboard SHALL use React Router v7 with `createBrowserRouter`. All page components SHALL be lazy-loaded via `React.lazy()` and dynamic imports. A loading fallback SHALL be displayed while pages load. The router SHALL include routes for the six menu CRUD pages: `/categories`, `/subcategories`, `/products`, `/allergens`, `/ingredients`, `/recipes`. Each menu route SHALL be inside the protected `<MainLayout>` tree and SHALL have a `handle.breadcrumb` key pointing to `layout.breadcrumb.menu.<page>`.

#### Scenario: Routes are defined with createBrowserRouter
- **WHEN** the Dashboard app initializes
- **THEN** it SHALL create routes using `createBrowserRouter` and render via `<RouterProvider>`

#### Scenario: Page components are lazy-loaded
- **WHEN** navigating to a route for the first time
- **THEN** the page component SHALL be loaded via dynamic import with a visible loading indicator during the load

#### Scenario: 404 page for unknown routes
- **WHEN** navigating to an undefined route like `/nonexistent`
- **THEN** the Dashboard SHALL render the NotFoundPage with a message and a link back to home

#### Scenario: Menu CRUD routes exist and are protected
- **WHEN** a non-authenticated user navigates to `/categories`, `/products`, or any other menu route
- **THEN** the ProtectedRoute SHALL redirect to `/login`

#### Scenario: Menu route breadcrumb
- **WHEN** an authenticated user navigates to `/products`
- **THEN** the breadcrumbs SHALL show the translated `layout.breadcrumb.menu.products` label (e.g., "Productos" in Spanish)
