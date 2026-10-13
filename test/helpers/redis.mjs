// Test helper: a real Redis behind an Upstash-compatible REST shim, so the Worker's Upstash client
// (including EVAL of the Lua scripts and MULTI/EXEC) is exercised against genuine Redis semantics.
// Uses REDIS_URL if set (CI service container), otherwise spawns a local redis-server if installed.
import net from "node:net";
import http from "node:http";
import { spawn, execSync } from "node:child_process";
import { Upstash } from "../../worker/src/redis.js";

function encode(args) { return `*${args.length}\r\n` + args.map((a) => { const s = String(a); return `$${Buffer.byteLength(s)}\r\n${s}\r\n`; }).join(""); }

class Resp {
  constructor(sock) { this.sock = sock; this.buf = Buffer.alloc(0); this.waiters = []; sock.on("data", (d) => { this.buf = Buffer.concat([this.buf, d]); this.drain(); }); }
  send(args) { return new Promise((resolve) => { this.waiters.push(resolve); this.sock.write(encode(args)); }); }
  drain() { while (this.waiters.length) { const r = this.parse(0); if (!r) return; this.buf = this.buf.subarray(r.end); this.waiters.shift()(r.value); } }
  parse(i) {
    const nl = this.buf.indexOf("\r\n", i); if (nl < 0) return null;
    const type = String.fromCharCode(this.buf[i]), line = this.buf.toString("utf8", i + 1, nl);
    if (type === "+") return { value: { result: line }, end: nl + 2 };
    if (type === "-") return { value: { error: line }, end: nl + 2 };
    if (type === ":") return { value: { result: Number(line) }, end: nl + 2 };
    if (type === "$") { const n = Number(line); if (n < 0) return { value: { result: null }, end: nl + 2 }; if (this.buf.length < nl + 2 + n + 2) return null; return { value: { result: this.buf.toString("utf8", nl + 2, nl + 2 + n) }, end: nl + 2 + n + 2 }; }
    if (type === "*") {
      const n = Number(line); if (n < 0) return { value: { result: null }, end: nl + 2 };
      let pos = nl + 2; const out = [];
      for (let k = 0; k < n; k++) { const r = this.parse(pos); if (!r) return null; if (r.value.error) out.push(r.value); else out.push(r.value.result); pos = r.end; }
      return { value: { result: out }, end: pos };
    }
    throw new Error("bad RESP " + type);
  }
}

export async function startRedis() {
  let url = process.env.REDIS_URL, proc = null;
  if (!url) {
    try { execSync("command -v redis-server", { stdio: "ignore" }); } catch { return null; }
    const port = 20000 + Math.floor(Math.random() * 20000);
    proc = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    url = `redis://127.0.0.1:${port}`;
    await new Promise((r) => setTimeout(r, 300));
  }
  const { hostname, port } = new URL(url);
  const sock = net.connect(Number(port || 6379), hostname);
  await new Promise((res, rej) => { sock.once("connect", res); sock.once("error", rej); }).catch(() => null);
  if (sock.destroyed) { proc?.kill(); return null; }
  const resp = new Resp(sock);
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const cmds = JSON.parse(body);
    let out;
    if (req.url === "/pipeline") out = [];
    if (req.url === "/pipeline") for (const c of cmds) out.push(await resp.send(c));
    else if (req.url === "/multi-exec") {
      await resp.send(["MULTI"]); for (const c of cmds) await resp.send(c);
      const exec = await resp.send(["EXEC"]);
      out = (exec.result || []).map((r) => (r && r.error ? r : { result: r }));
    } else out = await resp.send(cmds);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const restUrl = `http://127.0.0.1:${server.address().port}`;
  const client = new Upstash(restUrl, "test-token");
  return {
    client,
    flush: () => resp.send(["FLUSHALL"]),
    close: async () => { server.close(); sock.end(); proc?.kill(); },
  };
}
