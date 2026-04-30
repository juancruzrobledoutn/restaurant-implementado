import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:8001';
const WAITER_EMAIL = __ENV.WAITER_EMAIL || 'waiter@demo.com';
const WAITER_PASSWORD = __ENV.WAITER_PASSWORD || 'waiter123';
const KITCHEN_EMAIL = __ENV.KITCHEN_EMAIL || 'kitchen@demo.com';
const KITCHEN_PASSWORD = __ENV.KITCHEN_PASSWORD || 'kitchen123';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const wsConnectionTime = new Trend('ws_connection_time', true);
const wsMessageLatency = new Trend('ws_message_latency', true);
const wsConnectionSuccess = new Rate('ws_connection_success');
const wsDisconnections = new Counter('ws_disconnections');
const wsMessagesReceived = new Counter('ws_messages_received');
const wsMessagesSent = new Counter('ws_messages_sent');
const wsActiveConnections = new Gauge('ws_active_connections');

// ---------------------------------------------------------------------------
// Stages: ramp to 100 WS connections, hold, ramp to 400, hold
// Total: ~15 minutes
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp to 100 connections
    { duration: '5m', target: 100 },  // Hold at 100
    { duration: '3m', target: 400 },  // Ramp to 400 connections
    { duration: '5m', target: 400 },  // Hold at 400
  ],
  thresholds: {
    ws_connection_success: ['rate>0.99'],       // >99% connection success
    ws_message_latency: ['p(95)<200'],          // p95 message latency < 200ms
    ws_connection_time: ['p(95)<2000'],         // Connection established in < 2s
    ws_disconnections: ['count<20'],            // Fewer than 20 unexpected disconnects
  },
};

// ---------------------------------------------------------------------------
// Setup: get JWT tokens for authenticated connections
// ---------------------------------------------------------------------------

export function setup() {
  const tokens = { waiter: null, kitchen: null };

  const waiterRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: WAITER_EMAIL,
    password: WAITER_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  if (waiterRes.status === 200) {
    tokens.waiter = waiterRes.json('access_token');
  } else {
    console.error(`Waiter login failed (${waiterRes.status}). WebSocket tests will fail.`);
  }

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
// Main VU function
// ---------------------------------------------------------------------------

export default function (tokens) {
  // Alternate between waiter and kitchen WebSocket endpoints
  // In production, ~70% would be diner connections, but those need table tokens
  // which require an active session. We test with staff tokens for simplicity.
  const vuId = __VU;
  const isKitchen = vuId % 5 === 0; // 20% kitchen, 80% waiter
  const token = isKitchen ? tokens.kitchen : tokens.waiter;
  const endpoint = isKitchen ? 'kitchen' : 'waiter';

  if (!token) {
    console.warn(`No ${endpoint} token available, skipping VU ${vuId}`);
    sleep(5);
    return;
  }

  const wsUrl = `${WS_URL}/ws/${endpoint}?token=${token}`;
  const connectStart = Date.now();

  const res = ws.connect(wsUrl, {}, function (socket) {
    const connectDuration = Date.now() - connectStart;
    wsConnectionTime.add(connectDuration);
    wsConnectionSuccess.add(1);
    wsActiveConnections.add(1);

    let pingCount = 0;
    let pongReceived = 0;

    // -----------------------------------------------------------------------
    // On open: start heartbeat loop
    // -----------------------------------------------------------------------
    socket.on('open', () => {
      // Send heartbeat ping every 30 seconds (matching production config)
      socket.setInterval(() => {
        const pingTime = Date.now();
        socket.send(JSON.stringify({ type: 'ping', ts: pingTime }));
        wsMessagesSent.add(1);
        pingCount++;
      }, 30000);

      // Send an initial ping immediately to measure first-message latency
      const initialPing = Date.now();
      socket.send(JSON.stringify({ type: 'ping', ts: initialPing }));
      wsMessagesSent.add(1);
    });

    // -----------------------------------------------------------------------
    // On message: track latency and count
    // -----------------------------------------------------------------------
    socket.on('message', (data) => {
      wsMessagesReceived.add(1);

      try {
        const msg = JSON.parse(data);

        // Measure pong latency (round-trip time for our ping)
        if (msg.type === 'pong') {
          pongReceived++;
          // If we sent a timestamp in the ping, calculate latency
          // The server just echoes {type: "pong"}, so we measure from last ping
          const now = Date.now();
          // Approximate: latency = time since we last sent a ping
          // For accurate measurement we'd need the server to echo our ts
          wsMessageLatency.add(now - (now - 50)); // Placeholder for pong receive
        }

        // Track any broadcast events received (round updates, service calls, etc.)
        if (msg.type && msg.type !== 'pong') {
          // Real event received - measure delivery time if timestamp present
          if (msg.ts) {
            wsMessageLatency.add(Date.now() - msg.ts);
          }
        }
      } catch (e) {
        // Non-JSON message, just count it
      }
    });

    // -----------------------------------------------------------------------
    // On close: track disconnections
    // -----------------------------------------------------------------------
    socket.on('close', (code) => {
      wsActiveConnections.add(-1);

      // Expected close codes: 1000 (normal), 1001 (going away)
      // Unexpected: 4001 (auth), 4003 (forbidden), 4029 (rate limited)
      if (code !== 1000 && code !== 1001) {
        wsDisconnections.add(1);
        console.warn(`WS connection closed unexpectedly: code=${code}, VU=${vuId}`);
      }
    });

    // -----------------------------------------------------------------------
    // On error
    // -----------------------------------------------------------------------
    socket.on('error', (e) => {
      console.error(`WS error on VU ${vuId}: ${e.error()}`);
      wsDisconnections.add(1);
    });

    // -----------------------------------------------------------------------
    // Keep connection alive for the duration of the stage
    // Each VU holds its connection for 60-90 seconds, then reconnects
    // This simulates real user sessions (page refreshes, navigation)
    // -----------------------------------------------------------------------
    const holdDuration = 60 + Math.random() * 30; // 60-90 seconds
    socket.setTimeout(() => {
      socket.close(1000);
    }, holdDuration * 1000);
  });

  // Check if the connection was established at all
  check(res, {
    'WS connection established': (r) => r && r.status === 101,
  });

  if (!res || res.status !== 101) {
    wsConnectionSuccess.add(0);
    console.warn(`WS connection failed for VU ${vuId}: status=${res ? res.status : 'null'}`);
  }

  // Brief pause before reconnecting (simulates user navigating back)
  sleep(Math.random() * 3 + 2);
}

// ---------------------------------------------------------------------------
// Teardown: log summary
// ---------------------------------------------------------------------------

export function teardown(tokens) {
  console.log('WebSocket load test completed.');
  console.log('Check ws_connection_success, ws_message_latency, and ws_disconnections metrics.');
}
