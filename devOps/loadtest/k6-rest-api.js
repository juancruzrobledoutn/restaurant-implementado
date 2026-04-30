import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@demo.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'admin123';
const WAITER_EMAIL = __ENV.WAITER_EMAIL || 'waiter@demo.com';
const WAITER_PASSWORD = __ENV.WAITER_PASSWORD || 'waiter123';
const KITCHEN_EMAIL = __ENV.KITCHEN_EMAIL || 'kitchen@demo.com';
const KITCHEN_PASSWORD = __ENV.KITCHEN_PASSWORD || 'kitchen123';
const BRANCH_SLUG = __ENV.BRANCH_SLUG || 'centro';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const menuFetchDuration = new Trend('menu_fetch_duration', true);
const loginDuration = new Trend('login_duration', true);
const adminListDuration = new Trend('admin_list_duration', true);
const kitchenRoundsDuration = new Trend('kitchen_rounds_duration', true);
const waiterTablesDuration = new Trend('waiter_tables_duration', true);
const errorRate = new Rate('errors');
const menuCacheHits = new Counter('menu_cache_hits');
const menuCacheMisses = new Counter('menu_cache_misses');

// ---------------------------------------------------------------------------
// Stages: ramp-up -> hold -> spike -> hold -> ramp-down
// Total: ~11 minutes
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 VUs
    { duration: '3m', target: 50 },   // Hold at 50
    { duration: '2m', target: 200 },  // Ramp up to 200
    { duration: '3m', target: 200 },  // Hold at 200
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],            // 95th percentile < 500ms
    errors: ['rate<0.01'],                       // Error rate < 1%
    menu_fetch_duration: ['p(95)<300'],          // Menu should be fast (cached)
    login_duration: ['p(95)<800'],               // Login can be slower (bcrypt)
    admin_list_duration: ['p(95)<500'],
    kitchen_rounds_duration: ['p(95)<500'],
    waiter_tables_duration: ['p(95)<500'],
  },
};

// ---------------------------------------------------------------------------
// Setup: authenticate once per role and share tokens across VUs
// ---------------------------------------------------------------------------

export function setup() {
  const tokens = {};

  // Login as admin
  const adminRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  if (adminRes.status === 200) {
    tokens.admin = adminRes.json('access_token');
  } else {
    console.warn(`Admin login failed (${adminRes.status}). Admin/kitchen/waiter scenarios will skip.`);
  }

  // Login as waiter
  const waiterRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: WAITER_EMAIL,
    password: WAITER_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  if (waiterRes.status === 200) {
    tokens.waiter = waiterRes.json('access_token');
  }

  // Login as kitchen
  const kitchenRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: KITCHEN_EMAIL,
    password: KITCHEN_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  if (kitchenRes.status === 200) {
    tokens.kitchen = kitchenRes.json('access_token');
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

function pickScenario() {
  // Weighted random selection matching traffic distribution:
  // 60% public menu, 5% login, 15% admin, 10% kitchen, 10% waiter
  const roll = Math.random() * 100;
  if (roll < 60) return 'menu';
  if (roll < 65) return 'login';
  if (roll < 80) return 'admin';
  if (roll < 90) return 'kitchen';
  return 'waiter';
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function scenarioPublicMenu() {
  group('Public Menu Fetch', () => {
    const res = http.get(`${BASE_URL}/api/public/menu/${BRANCH_SLUG}`);
    menuFetchDuration.add(res.timings.duration);

    const success = check(res, {
      'menu status is 200': (r) => r.status === 200,
      'menu has data': (r) => r.body && r.body.length > 2,
    });

    if (!success) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }

    // Check cache headers if present (X-Cache or similar)
    const cacheHeader = res.headers['X-Cache'] || res.headers['x-cache'];
    if (cacheHeader && cacheHeader.includes('HIT')) {
      menuCacheHits.add(1);
    } else {
      menuCacheMisses.add(1);
    }
  });
}

function scenarioLogin() {
  group('Auth Login', () => {
    // Use a test user to exercise the login path under load
    const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
      email: WAITER_EMAIL,
      password: WAITER_PASSWORD,
    }), { headers: { 'Content-Type': 'application/json' } });

    loginDuration.add(res.timings.duration);

    const success = check(res, {
      'login status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    });

    // 429 (rate limited) is expected under heavy load, not an error
    if (res.status !== 200 && res.status !== 429) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }
  });
}

function scenarioAdminCategories(tokens) {
  group('Admin List Categories', () => {
    if (!tokens.admin) {
      return; // Skip if no admin token
    }

    const res = http.get(
      `${BASE_URL}/api/admin/categories?limit=50&offset=0`,
      authHeaders(tokens.admin),
    );
    adminListDuration.add(res.timings.duration);

    const success = check(res, {
      'admin categories status is 200': (r) => r.status === 200,
    });

    if (!success) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }
  });
}

function scenarioKitchenRounds(tokens) {
  group('Kitchen Rounds', () => {
    if (!tokens.kitchen) {
      return;
    }

    const res = http.get(
      `${BASE_URL}/api/kitchen/rounds`,
      authHeaders(tokens.kitchen),
    );
    kitchenRoundsDuration.add(res.timings.duration);

    const success = check(res, {
      'kitchen rounds status is 200': (r) => r.status === 200,
    });

    if (!success) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }
  });
}

function scenarioWaiterTables(tokens) {
  group('Waiter Tables', () => {
    if (!tokens.waiter) {
      return;
    }

    const res = http.get(
      `${BASE_URL}/api/waiter/tables`,
      authHeaders(tokens.waiter),
    );
    waiterTablesDuration.add(res.timings.duration);

    const success = check(res, {
      'waiter tables status is 200': (r) => r.status === 200,
    });

    if (!success) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }
  });
}

// ---------------------------------------------------------------------------
// Main VU loop
// ---------------------------------------------------------------------------

export default function (tokens) {
  const scenario = pickScenario();

  switch (scenario) {
    case 'menu':
      scenarioPublicMenu();
      break;
    case 'login':
      scenarioLogin();
      break;
    case 'admin':
      scenarioAdminCategories(tokens);
      break;
    case 'kitchen':
      scenarioKitchenRounds(tokens);
      break;
    case 'waiter':
      scenarioWaiterTables(tokens);
      break;
  }

  // Simulate realistic user think time (1-3 seconds)
  sleep(Math.random() * 2 + 1);
}
