## MODIFIED Requirements

### Requirement: Collapsible sidebar with icon-only mode

The sidebar SHALL support two states: expanded (shows icons + text labels) and collapsed (shows icons only). The collapse state SHALL be toggled via a button in the sidebar. The collapsed/expanded state SHALL persist in `localStorage` under key `sidebar-collapsed`. On screens narrower than 768px, the sidebar SHALL be hidden by default and toggled via a hamburger button in the navbar. The sidebar SHALL organize navigation items in labeled groups: `Inicio` (single item), `Menu` (6 items: Categories, Subcategories, Products, Allergens, Ingredients, Recipes), `Facturación` (2 items: Cuentas at `/checks`, Pagos at `/payments` — visible ONLY for ADMIN and MANAGER roles), and placeholder slots for future groups (`Operaciones`, `Ajustes`). Each item SHALL include a lucide-react icon and a translated label via `t('layout.sidebar.<key>')`. Both the Menu group header and the Facturación group header SHALL display the translated `layout.sidebar.<group>.groupLabel` when the sidebar is expanded, and SHALL collapse to a divider with a tooltip on hover when the sidebar is collapsed. The active route's sidebar item SHALL have `aria-current="page"`.

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

#### Scenario: Facturación group renders two items for ADMIN
- **WHEN** an ADMIN user is authenticated and the sidebar is expanded
- **THEN** the Facturación group SHALL render two navigation items — `Cuentas` (linking to `/checks`, icon `Receipt` from lucide-react) and `Pagos` (linking to `/payments`, icon `CreditCard`) — with the group header displaying the translated `layout.sidebar.billing.groupLabel`

#### Scenario: Facturación group visible for MANAGER
- **WHEN** a MANAGER user is authenticated and the sidebar renders
- **THEN** the Facturación group SHALL appear with both items

#### Scenario: Facturación group hidden for WAITER
- **WHEN** a WAITER user is authenticated
- **THEN** the Facturación group SHALL NOT render (neither the header nor its items) in the sidebar

#### Scenario: Facturación group hidden for KITCHEN
- **WHEN** a KITCHEN user is authenticated
- **THEN** the Facturación group SHALL NOT render in the sidebar

#### Scenario: Active billing route highlighted
- **WHEN** an ADMIN navigates to `/checks`
- **THEN** the "Cuentas" sidebar item SHALL have `aria-current="page"` and the active visual state

#### Scenario: Facturación collapses to divider with tooltip
- **WHEN** the sidebar is collapsed and an ADMIN hovers the Facturación divider
- **THEN** a tooltip SHALL display the translated label "Facturación"

---

### Requirement: React Router v7 with lazy-loaded pages

The Dashboard SHALL use React Router v7 with `createBrowserRouter`. All page components SHALL be lazy-loaded via `React.lazy()` and dynamic imports. A loading fallback SHALL be displayed while pages load. The router SHALL include routes for the six menu CRUD pages: `/categories`, `/subcategories`, `/products`, `/allergens`, `/ingredients`, `/recipes`, and for the two billing pages: `/checks`, `/payments`. Each menu route SHALL be inside the protected `<MainLayout>` tree and SHALL have a `handle.breadcrumb` key pointing to `layout.breadcrumb.menu.<page>` or `layout.breadcrumb.billing.<page>` for billing routes. Billing routes (`/checks`, `/payments`) SHALL be additionally wrapped in a role guard that only allows ADMIN and MANAGER — other authenticated roles SHALL be redirected to `/`.

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

#### Scenario: Billing routes require ADMIN or MANAGER
- **WHEN** a WAITER navigates to `/checks`
- **THEN** the role guard SHALL redirect to `/` and the Checks page SHALL NOT render

#### Scenario: Billing route breadcrumb
- **WHEN** an ADMIN navigates to `/payments`
- **THEN** the breadcrumbs SHALL show the translated `layout.breadcrumb.billing.payments` label ("Pagos")

#### Scenario: Billing page component is lazy-loaded
- **WHEN** an ADMIN navigates to `/checks` for the first time in the session
- **THEN** `Checks.tsx` SHALL be loaded via dynamic import and a loading indicator SHALL be visible until the chunk is fetched
