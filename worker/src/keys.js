// Redis key schema (prefix ts:v1:). See docs/ARCHITECTURE.md for TTL rationale.
const P = "ts:v1:";
export const DAY = 86400;
export const K = {
  raw: (nct, hash) => `${P}raw:${nct}:${hash}`,   // full study JSON, content-addressed, TTL 24h
  query: (h) => `${P}q:${h}`,                      // search results, TTL 24h (fresh 1h, then stale-while-revalidate)
  study: (nct) => `${P}study:${nct}`,              // tracked state baseline, NO TTL
  seq: `${P}seq`,                                  // feed cursor counter, NO TTL
  epoch: `${P}epoch`,                              // set once; changes only if Redis was rebuilt
  feed: `${P}feed`,                                // ZSET of change entries, capped by rank, NO TTL
  watch: `${P}watch`,                              // ZSET nct -> last requested ms
  run: (slot) => `${P}run:${slot}`,                // cron idempotency marker, TTL 1h
  lockPoll: `${P}lock:poll`,                       // lease, PX 240000
  lockQuery: (h) => `${P}lock:q:${h}`,             // stampede guard, TTL 30s
  idem: (k) => `${P}idem:${k}`,                    // POST replay store, TTL 24h
  rate: (minute) => `${P}rl:ct:${minute}`,         // CT.gov budget, TTL 120s
  breaker: `${P}cb:ct`,
  breakerFails: `${P}cb:fails`,
  ai: (day) => `${P}ai:${day}`,                    // Workers AI daily budget, TTL 48h
};
export const FEED_CAP = 5000;
export const QUERY_FRESH_MS = 3600_000;
/** 24h TTL minus up to 30 minutes of jitter so entries written together don't all expire together. */
export const ttl24h = () => DAY - Math.floor(Math.random() * 1800);
