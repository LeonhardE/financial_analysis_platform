const assert = require("node:assert/strict");
const test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
const { DisplayLru, WorkspaceDisplayCache, DisplayReadPool } = compile("../lib/workspace-cache.ts");
const gate = () => {
  let resolve;
  return { promise: new Promise((r) => (resolve = r)), resolve: (v) => resolve(v) };
};

test("display LRU enforces entry/byte bounds, touches on read and refuses oversized data", () => {
  const c = new DisplayLru(2, 1000);
  c.set("a", "first");
  c.set("b", "second");
  c.get("a");
  c.set("c", "third");
  assert.equal(c.get("b"), undefined);
  assert.equal(c.size, 2);
  assert.ok(c.bytes <= 1000);
  assert.equal(c.set("large", "x".repeat(1000)), false);
  assert.equal(c.size, 2);
  c.clear();
  assert.equal(c.bytes, 0);
});

test("a display session owns all bounded caches and scope transitions synchronously clear them", () => {
  const c = new WorkspaceDisplayCache();
  c.bind("owner_A:vault_A:1");
  for (let n = 0; n < 40; n++) c.taskNames.set(String(n), "PRIVATE_NAME");
  for (let n = 0; n < 12; n++) c.reports.set(String(n), { title: "PRIVATE_REPORT" });
  for (let n = 0; n < 3; n++) c.holdings.set(String(n), { symbol: "PRIVATE_TICKER" });
  for (let n = 0; n < 3; n++) c.valuations.set(String(n), { amount: "PRIVATE_VALUE" });
  assert.equal(c.valuations.size, 2);
  assert.deepEqual([c.taskNames.size, c.reports.size, c.holdings.size], [32, 10, 2]);
  c.bind("owner_A:vault_A:1");
  assert.equal(c.reports.size, 10);
  for (const scope of ["owner_A:vault_A:2", "owner_A:vault_B:2", "owner_B:vault_B:2", null]) {
    c.bind(scope);
    assert.equal(c.taskNames.size + c.reports.size + c.holdings.size + c.valuations.size, 0);
    c.reports.set("a", "private");
  }
  c.clear();
  assert.equal(c.reports.size, 0);
});

test("coalesced display reads share one transport but keep independent streamed bodies and cancellation", async () => {
  const p = new DisplayReadPool(),
    g = gate(),
    a = new AbortController(),
    b = new AbortController();
  let calls = 0,
    transportSignal;
  const send = (signal) => {
    calls++;
    transportSignal = signal;
    return g.promise;
  };
  const first = p.run("owner_A:catalogue", send, a.signal);
  const firstRejected = assert.rejects(first, /cancelled/);
  const second = p.run("owner_A:catalogue", send, b.signal);
  await Promise.resolve();
  a.abort();
  await firstRejected;
  assert.equal(calls, 1);
  assert.equal(transportSignal.aborted, false);
  let body;
  g.resolve(
    new Response(
      new ReadableStream({
        start(c) {
          body = c;
        },
      }),
    ),
  );
  const r = await second;
  assert.equal(transportSignal.aborted, false);
  body.enqueue(new TextEncoder().encode("verified display"));
  body.close();
  assert.equal(await r.text(), "verified display");
});

test("all cancelled subscribers abort transport; completed reads and different owners are never cached", async () => {
  const p = new DisplayReadPool(),
    a = new AbortController(),
    g = gate();
  let signal;
  const first = p.run(
    "A:list",
    (s) => {
      signal = s;
      return g.promise;
    },
    a.signal,
  );
  const rejected = assert.rejects(first, /cancelled/);
  await Promise.resolve();
  a.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  g.resolve(new Response("late"));
  let calls = 0;
  const send = async () => {
    calls++;
    return new Response("fresh");
  };
  const [x, y] = await Promise.all([p.run("A:list", send), p.run("B:list", send)]);
  assert.equal(await x.text(), "fresh");
  assert.equal(await y.text(), "fresh");
  assert.equal(calls, 2);
  const next = await p.run("A:list", send);
  assert.equal(await next.text(), "fresh");
  assert.equal(calls, 3);
});

test("private reads queue at two transports, cancel before dispatch and release capacity on failure", async () => {
  const p = new DisplayReadPool(),
    gates = [gate(), gate(), gate(), gate()];
  const a = new AbortController();
  const calls = [];
  const send = (i) => () => {
    calls.push(i);
    return gates[i].promise;
  };
  const first = p.run("one", send(0));
  const second = p.run("two", send(1));
  const cancelled = p.run("three", send(2), a.signal);
  const rejects = assert.rejects(cancelled, /cancelled/);
  const fourth = p.run("four", send(3));
  await Promise.resolve();
  assert.deepEqual(calls, [0, 1]);
  a.abort();
  await rejects;
  gates[0].resolve(new Response("first"));
  await first;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [0, 1, 3]);
  p.clear();
  gates[1].resolve(new Response("second"));
  gates[3].resolve(new Response("fourth"));
  await Promise.allSettled([second, fourth]);
  const fresh = await p.run("fresh", async () => new Response("fresh"));
  assert.equal(await fresh.text(), "fresh");
});

test("cancelling a dispatched read settles its subscriber while retaining the physical slot", async () => {
  const pool = new DisplayReadPool(),
    a = new AbortController(),
    first = gate(),
    second = gate(),
    third = gate();
  let sent = 0,
    cancelledBody = 0;
  const run = (g, signal) =>
    pool.queue(() => {
      sent++;
      return g.promise;
    }, signal);
  const p1 = run(first, a.signal),
    p2 = run(second),
    p3 = run(third);
  const rejected = assert.rejects(p1, /cancelled/);
  await Promise.resolve();
  assert.equal(sent, 2);
  a.abort();
  await rejected;
  assert.equal(sent, 2, "ignored abort must not admit a third physical transport");
  first.resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelledBody++;
        },
      }),
    ),
  );
  await new Promise(setImmediate);
  assert.equal(cancelledBody, 1);
  assert.equal(sent, 3);
  second.resolve(new Response("two"));
  third.resolve(new Response("three"));
  await Promise.all([p2, p3]);
});

test("bounded JSON cancels excess UTF-8 bytes, bad lengths, malformed text and stuck readers", async () => {
  const { boundedJson } = compile("../lib/workspace-cache.ts");
  for (const response of [
    new Response(JSON.stringify({ x: "密".repeat(8) })),
    new Response("{}", { headers: { "Content-Length": "9000" } }),
    new Response(new Uint8Array([0xff])),
    new Response("{"),
  ])
    await assert.rejects(boundedJson(response, 20, new AbortController().signal));
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await boundedJson(Response.json({ x: "密" }), 16, new AbortController().signal),
      ),
    ),
    { x: "密" },
  );
  const control = new AbortController();
  let cancelled = 0;
  const pending = boundedJson(
    {
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: async () => {
            cancelled++;
          },
          releaseLock() {
            throw Error("still pending");
          },
        }),
      },
    },
    100,
    control.signal,
  );
  const rejected = assert.rejects(pending, /cancelled/);
  control.abort();
  await rejected;
  assert.ok(cancelled > 0);
});

test("abort-aware waits settle ignored SDK calls and consume their late rejection", async () => {
  const { untilSignal } = compile("../lib/workspace-cache.ts");
  const a = new AbortController();
  let reject;
  const wait = untilSignal(
    new Promise((_, no) => {
      reject = no;
    }),
    a.signal,
    () => Error("deadline"),
  );
  const rejected = assert.rejects(wait, /deadline/);
  a.abort();
  await rejected;
  reject(Error("late SDK failure"));
  await new Promise(setImmediate);
  await assert.rejects(untilSignal(Promise.resolve("ignored"), a.signal), /cancelled/);
});
