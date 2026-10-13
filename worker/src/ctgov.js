// ClinicalTrials.gov API v2 client with a global rate limiter and a circuit breaker kept in Redis.
import { K } from "./keys.js";

export const CT_BASE = "https://clinicaltrials.gov/api/v2/";
export const CT_PER_MINUTE = 30; // stays well under the public ~50 req/min guidance

export class CtError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

/**
 * GET a ClinicalTrials.gov endpoint.
 * redis may be null (Redis down): then we skip the shared limiter and rely on the edge cache.
 */
export async function ctGet(path, params, { redis, fetchImpl = (...a) => fetch(...a), now = Date.now(), timeoutMs = 8000 } = {}) {
  if (redis) {
    const minute = Math.floor(now / 60000);
    let r;
    try {
      r = await redis.pipeline([["GET", K.breaker], ["INCR", K.rate(minute)], ["EXPIRE", K.rate(minute), 120]]);
    } catch { r = null; }
    if (r) {
      if (r[0]) throw new CtError("ClinicalTrials.gov is cooling down after errors", "breaker", 503);
      if (Number(r[1]) > CT_PER_MINUTE) throw new CtError("Too many registry requests this minute", "rate", 429);
    }
  }
  const qs = new URLSearchParams(params || {});
  let res;
  try {
    res = await fetchImpl(`${CT_BASE}${path}?${qs}`, {
      headers: { accept: "application/json", "user-agent": "TrialSignal/2.0 (+https://github.com)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    await trip(redis);
    throw new CtError(`ClinicalTrials.gov unreachable: ${e.message}`, "unavailable", 502);
  }
  if (res.status === 404) throw new CtError("No study with that number", "not_found", 404);
  if (res.status === 429 || res.status >= 500) {
    await trip(redis);
    throw new CtError(`ClinicalTrials.gov returned ${res.status}`, "upstream", 502);
  }
  if (!res.ok) throw new CtError(`ClinicalTrials.gov returned ${res.status}`, "bad_request", res.status);
  return res.json();
}

async function trip(redis) {
  if (!redis) return;
  try {
    const [fails] = await redis.pipeline([["INCR", K.breakerFails], ["EXPIRE", K.breakerFails, 120]]);
    if (Number(fails) >= 3) await redis.cmd("SET", K.breaker, "1", "EX", 120);
  } catch { /* breaker is best-effort */ }
}
