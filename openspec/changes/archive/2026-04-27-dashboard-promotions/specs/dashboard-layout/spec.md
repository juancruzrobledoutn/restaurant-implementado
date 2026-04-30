# dashboard-layout Delta Spec

> Change: **C-27 dashboard-promotions**. Extends the sidebar and router to include the new Promotions page. No behavior of existing layout requirements changes — sidebar, navbar, breadcrumbs, lazy routing, ProtectedRoute all continue as-is. Only the `Menu` group gets one more item and the router gets one more route.

## MODIFIED Requirements

### Requirement: Collapsible sidebar with icon-only mode

The sidebar SHALL support two states: expanded (shows icons + text labels) and collapsed (shows icons only). The collapse state SHALL be toggled via a button in the sidebar. The collapsed/expanded state SHALL persist in `localStorage` under key `sidebar-collapsed`. On screens narrower than 768px, the sidebar SHALL be hidden by default and toggled via a hamburger button in the navbar. The sidebar SHALL organize navigation items in labeled groups: `Inicio` (single item), `Menu` (7 items: Categories, Subcategories, Products, Allergens, Ingredients, Recipes, Promotions), and placeholder slots for future groups (`Operaciones`, `Ajustes`). Each item SHALL include a lucide-react icon and a translated label via `t('layout.sidebar.<key>')`. The Menu group header SHALL display the translated `layout.sidebar.menu.groupLabel` when the sidebar is expanded, and SHALL collapse to a divider with a tooltip on hover when the sidebar is collapsed. The active route's sidebar item SHALL have `aria-current="page"`. The Promotions item SHALL render only when the authenticated user's derived `canManagePromotions` is `true` (ADMIN or MANAGER).

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

#### Scenario: Menu section renders seven items for ADMIN/MANAGER
- **WHEN** the sidebar is in expanded mode for an ADMIN or MANAGER user
- **THEN** the Menu group SHALL render seven navigation items (Categories, Subcategories, Products, Allergens, Ingredients, Recipes, Promotions), each with a lucide-react icon and translated label

#### Scenario: Promotions hidden for KITCHEN and WAITER
- **WHEN** the sidebar renders for a user whose role is KITCHEN or WAITER
- **THEN** the "Promotions" item SHALL NOT render (the Menu group shows only the six menu items)

#### Scenario: Active Menu route highlighted
- **WHEN** the user is on `/products`
- **THEN** the "Products" sidebar item SHALL have `aria-current="page"` and the active visual state

#### Scenario: Promotions active route highlighted
- **WHEN** the user is on `/promotions`
- **THEN** the "Promotions" sidebar item SHALL have `aria-current="page"` and the active visual state

### Requirement: React Router v7 with lazy-loaded pages

The Dashboard SHALL use React Router v7 with `createBrowserRouter`. All page components SHALL be lazy-loaded via `React.lazy()` and dynamic imports. A loading fallback SHALL be displayed while pages load. The router SHALL include routes for the six menu CRUD pages (`/categories`, `/subcategories`, `/products`, `/allergens`, `/ingredients`, `/recipes`) plus the Promotions page (`/promotions`). Each menu route SHALL be inside the protected `<MainLayout>` tree and SHALL have a `handle.breadcrumb` key pointing to `layout.breadcrumb.menu.<page>`. The Promotions route SHALL have `handle.breadcrumb = 'layout.breadcrumb.promotions'`.

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
- **WHEN** a non-authenticated user navigates to `/categories`, `/products`, `/promotions`, or any other menu route
- **THEN** the ProtectedRoute SHALL redirect to `/login`

#### Scenario: Menu route breadcrumb
- **WHEN** an authenticated user navigates to `/products`
- **THEN** the breadcrumbs SHALL show the translated `layout.breadcrumb.menu.products` label (e.g., "Productos" in Spanish)

#### Scenario: Promotions route breadcrumb
- **WHEN** an authenticated user navigates to `/promotions`
- **THEN** the breadcrumbs SHALL show the translated `layout.breadcrumb.promotions` label (e.g., "Promociones" in Spanish)
