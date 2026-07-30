import { vu } from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3100';
const TOKEN = __ENV.TOKEN;
const FROM = __ENV.FROM;
const TO = __ENV.TO;
const CURRENCY = __ENV.CURRENCY || 'USD';
const VUS = Number(__ENV.VUS || 30);
const DURATION = __ENV.DURATION || '20s';

// Optional sharded mode: ACCOUNTS is a JSON array of funded account ids. Each VU debits
// its own account, so writes hit distinct row locks — measuring the throughput ceiling
// without hot-account contention. Falls back to the single FROM/TO hot-account worst case.
const ACCOUNTS = __ENV.ACCOUNTS ? JSON.parse(__ENV.ACCOUNTS) : null;

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const transferLatency = new Trend('transfer_latency', true);

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    transfer: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      exec: 'transferScenario',
      tags: { endpoint: 'transfer' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    transfer_latency: ['p(95)<150'],
  },
};

// No Idempotency-Key: each request is a genuinely new 1-unit posting, not a dedup no-op.
const hotBody = JSON.stringify({ from: FROM, to: TO, amount: '1', currency: CURRENCY });

export function transferScenario() {
  let body = hotBody;
  if (ACCOUNTS) {
    const from = ACCOUNTS[(vu.idInTest - 1) % ACCOUNTS.length];
    const to = ACCOUNTS[vu.idInTest % ACCOUNTS.length];
    body = JSON.stringify({ from, to, amount: '1', currency: CURRENCY });
  }
  const res = http.post(`${BASE}/transfers`, body, { headers });
  check(res, { 'transfer → 201': (r) => r.status === 201 });
  transferLatency.add(res.timings.duration);
}
