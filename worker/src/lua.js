// Lua scripts executed atomically inside Redis (Upstash supports EVAL; each EVAL is one command).

/**
 * APPLY: compare-and-set the tracked state of N studies and append real changes to the feed.
 * KEYS[1]=seq  KEYS[2]=feed  KEYS[3..]=study:{NCT}
 * ARGV[1]=now(ms)  ARGV[2]=feed cap  then 4 args per study: nct, hash(32 hex), lastUpdate(YYYY-MM-DD or ""), stateJSON
 * Guarantees:
 *  - validate-before-write: any bad input aborts before the first write (Redis has no rollback);
 *  - idempotent: same hash => no-op, so replays add zero feed entries;
 *  - monotonic: an older lastUpdate never overwrites a newer one;
 *  - a study seen for the first time sets a baseline and emits nothing.
 * Returns {applied, skipped, initialized}.
 */
export const APPLY = `
local now = tonumber(ARGV[1]); local cap = tonumber(ARGV[2])
local n = #KEYS - 2
if now == nil or cap == nil or cap < 1 then return redis.error_reply('ERR bad header') end
if #ARGV ~= 2 + n * 4 then return redis.error_reply('ERR arity') end
local items = {}
for i = 1, n do
  local b = 2 + (i - 1) * 4
  local nct, h, lup, st = ARGV[b + 1], ARGV[b + 2], ARGV[b + 3], ARGV[b + 4]
  if not string.match(nct, '^NCT%d%d%d%d%d%d%d%d$') then return redis.error_reply('ERR bad nct at ' .. i) end
  if #h ~= 32 or not string.match(h, '^%x+$') then return redis.error_reply('ERR bad hash at ' .. i) end
  if lup ~= '' and not string.match(lup, '^%d%d%d%d%-%d%d') then return redis.error_reply('ERR bad lup at ' .. i) end
  if string.sub(KEYS[2 + i], -#nct) ~= nct then return redis.error_reply('ERR key mismatch at ' .. i) end
  local ok, decoded = pcall(cjson.decode, st)
  if not ok or type(decoded) ~= 'table' then return redis.error_reply('ERR bad state at ' .. i) end
  items[i] = { nct = nct, hash = h, lup = lup, state = decoded }
end
local fields = { 'status', 'start', 'pcd', 'cd', 'enroll', 'enrollType' }
local applied, skipped, init = 0, 0, 0
for i = 1, n do
  local it = items[i]; local key = KEYS[2 + i]
  local rec = it.state; rec.hash = it.hash; rec.lup = it.lup; rec.polledAt = now
  local raw = redis.call('GET', key)
  if not raw then
    rec.seq = 0
    redis.call('SET', key, cjson.encode(rec))
    init = init + 1
  else
    local cur = cjson.decode(raw)
    if cur.hash == it.hash then
      skipped = skipped + 1
    elseif it.lup ~= '' and type(cur.lup) == 'string' and cur.lup ~= '' and it.lup < cur.lup then
      skipped = skipped + 1
    else
      local seq = redis.call('INCR', KEYS[1])
      local changed = {}
      for _, f in ipairs(fields) do
        if tostring(cur[f]) ~= tostring(rec[f]) then table.insert(changed, f) end
      end
      rec.seq = seq
      redis.call('SET', key, cjson.encode(rec))
      local entry = { seq = seq, nct = it.nct, hash = it.hash, prev = cur.hash, lup = it.lup, at = now, fields = changed,
        state = { status = rec.status, start = rec.start, pcd = rec.pcd, cd = rec.cd, enroll = rec.enroll, enrollType = rec.enrollType } }
      redis.call('ZADD', KEYS[2], seq, cjson.encode(entry))
      applied = applied + 1
    end
  end
end
redis.call('ZREMRANGEBYRANK', KEYS[2], 0, -(cap + 1))
return { applied, skipped, init }
`;

/** RELEASE: delete a lease only if we still own it (token match). KEYS[1]=lock ARGV[1]=token */
export const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
