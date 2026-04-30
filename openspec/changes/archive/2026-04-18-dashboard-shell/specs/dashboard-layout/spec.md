# dashboard-layout Delta Spec

> Change: **C-14 dashboard-shell**. Establishes the navigable shell of the Dashboard
> (layout, sidebar, navbar, breadcrumbs, router, base pages).

## MODIFIED Requirements

### Requirement: MainLayout provides sidebar, navbar, and content area

The Dashboard SHALL provide a `MainLayout` component that renders a collapsible sidebar on the left, a top navbar, and a content area that renders the current route's component via React Router's `<Outlet>`. The layout SHALL only be rendered for authenticated routes (not the login page).

#### Scenario: Layout structure renders correctly
- **WHEN** an authenticated user navigates to any protected route
- **THEN** the page SHALL display a sidebar on the left, a navbar at the top, and the page content in the remaining area

#### Scenario: Layout is not rendered on login page
- **WHEN** navigating to `/login`
- **THEN** the page SHALL render the LoginPage without sidebar or navbar

### Requirement: Collapsible sidebar with icon-only mode

The sidebar SHALL support two states: expanded (shows icons + text labels) and collapsed (shows icons only). The collapse state SHALL be toggled via a button in the sidebar. The collapsed/expanded state SHALL persist in `localStorage` under key `sidebar-collapsed`. On screens narrower than 768px, the sidebar SHALL be hidden by default and toggled via a hamburger button in the navbar.

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

### Requirement: Navbar displays user info and actions

The navbar SHALL display the authenticated user's full name and role(s), a language toggle (es/en), and a logout button. The logout button SHALL call authStore's `logout()` action.

#### Scenario: User info is displayed
- **WHEN** the navbar renders for an authenticated user
- **THEN** it SHALL display the user's `fullName` and primary role from authStore

#### Scenario: Logout button triggers logout
- **WHEN** the user clicks the logout button in the navbar
- **THEN** the authStore `logout()` action SHALL be called

#### Scenario: Language toggle switches locale
- **WHEN** the user clicks the language toggle
- **THEN** the i18n locale SHALL switch between `es` and `en` and persist the choice in `localStorage`

### Requirement: Breadcrumbs derived from route hierarchy

The Dashboard SHALL display breadcrumbs below the navbar that reflect the current route hierarchy. Breadcrumb labels SHALL come from route `handle` metadata and be translated via i18n.

#### Scenario: Home page shows single breadcrumb
- **WHEN** navigating to `/`
- **THEN** the breadcrumbs SHALL show "Inicio" (or "Home" in English)

#### Scenario: Nested route shows full path
- **WHEN** navigating to a nested route like `/categories/123`
- **THEN** the breadcrumbs SHALL show "Inicio > Categorias > Detalle" (or equivalent translated labels)

#### Scenario: Breadcrumb links are clickable
- **WHEN** clicking on a non-current breadcrumb item
- **THEN** the browser SHALL navigate to that breadcrumb's route

### Requirement: React Router v7 with lazy-loaded pages

The Dashboard SHALL use React Router v7 with `createBrowserRouter`. All page components SHALL be lazy-loaded via `React.lazy()` and dynamic imports. A loading fallback SHALL be displayed while pages load.

#### Scenario: Routes are defined with createBrowserRouter
- **WHEN** the Dashboard app initializes
- **THEN** it SHALL create routes using `createBrowserRouter` and render via `<RouterProvider>`

#### Scenario: Page components are lazy-loaded
- **WHEN** navigating to a route for the first time
- **THEN** the page component SHALL be loaded via dynamic import with a visible loading indicator during the load

#### Scenario: 404 page for unknown routes
- **WHEN** navigating to an undefined route like `/nonexistent`
- **THEN** the Dashboard SHALL render the NotFoundPage with a message and a link back to home

### Requirement: Home page renders an empty dashboard placeholder

The Dashboard SHALL provide a Home page at route `/` that displays a welcome message and placeholder content. This page SHALL be the default landing page after login.

#### Scenario: Home page renders welcome message
- **WHEN** an authenticated user navigates to `/`
- **THEN** the page SHALL display a welcome message with the user's name (from authStore) and placeholder text indicating future dashboard content

### Requirement: 404 page provides navigation back to home

The Dashboard SHALL provide a NotFoundPage that renders when no route matches. It SHALL display a "page not found" message and a link to navigate to the home page.

#### Scenario: 404 page renders with link to home
- **WHEN** the NotFoundPage is displayed
- **THEN** it SHALL show a "page not found" message (translated via i18n) and a button/link that navigates to `/`
