// Minimal zero-dependency Upstash Redis REST client.
// Docs: POST <url> with a JSON array command; POST <url>/pipeline with an array of commands;
// POST <url>/multi-exec for an atomic MULTI/EXEC transaction.

export class RedisError extends Error {
  constructor(message, code = "redis") { super(message); this.code = code; }
}

export class Upstash {
  constructor(url, token, { timeoutMs = 1500, fetchImpl = (...a) => fetch(...a) } = {}) {
    if (!url || !token) throw new RedisError("Upstash URL and token are required", "config");
    this.url = url.replace(/\/$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }
  async #post(path, body) {
    let res;
    try {
      res = await this.fetch(this.url + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new RedisError(`Redis unreachable: ${e.message}`, "unavailable");
    }
    const json = await res.json().catch(() => null);
    if (!res.ok && !Array.isArray(json)) throw new RedisError(json?.error || `Redis HTTP ${res.status}`, res.status === 429 ? "quota" : "unavailable");
    return json;
  }
  /** One command, e.g. cmd("SET", "k", "v", "EX", 60). Returns the result or throws. */
  async cmd(...args) {
    const json = await this.#post("", args.map(String));
    if (json?.error) throw new RedisError(json.error);
    return json?.result ?? null;
  }
  /** Several commands in one round trip (not atomic). Returns results; per-command errors become RedisError values. */
  async pipeline(cmds) {
    const json = await this.#post("/pipeline", cmds.map((c) => c.map(String)));
    return json.map((r) => (r.error ? new RedisError(r.error) : r.result));
  }
  /** Atomic MULTI/EXEC: either all commands run, in order, isolated from other clients. */
  async multi(cmds) {
    const json = await this.#post("/multi-exec", cmds.map((c) => c.map(String)));
    if (json?.error) throw new RedisError(json.error);
    return json.map((r) => (r.error ? new RedisError(r.error) : r.result));
  }
  eval(script, keys, args) {
    return this.cmd("EVAL", script, keys.length, ...keys, ...args);
  }
}
