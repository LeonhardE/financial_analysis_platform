const test = require("node:test"),
  assert = require("node:assert/strict");
const { compile } = require("./resource-library-helpers.cjs"),
  { providerGroups } = compile("../lib/provider-groups.ts");
function row(id, expires = 2000) {
  return {
    connection: { provider: "muse", connectionId: id, status: "active" },
    credential: {
      status: "active",
      expiresAt: expires,
      reference: {
        connectionId: id,
        clientId: "client",
        credentialGeneration: 1,
        credentialFingerprint: id.repeat(64).slice(0, 64),
      },
    },
    tasks: [],
  };
}
test("one live Muse credential is current while expired records stay in history", () => {
  const old = row("a", 900),
    next = row("b");
  const g = providerGroups([old, next], {}, 1000)[0];
  assert.equal(g.current, next);
  assert.equal(g.history[0], old);
  assert.equal(g.reviewRequired, false);
});
test("multiple live legacy credentials require review, never choosing an arbitrary winner", () => {
  const g = providerGroups([row("a"), row("b")], {}, 1000)[0];
  assert.equal(g.current, null);
  assert.equal(g.reviewRequired, true);
  assert.equal(g.history.length, 2);
});
test("the exact canonical slot wins and stale references never fall back to a different credential", () => {
  const a = row("a"),
    b = row("b"),
    state = { muse: { slot: { currentCredential: a.credential.reference }, legacyBlockers: [] } };
  let g = providerGroups([b, a], state, 1000)[0];
  assert.equal(g.current, a);
  state.muse.slot.currentCredential = { ...a.credential.reference, credentialGeneration: 2 };
  g = providerGroups([a, b], state, 1000)[0];
  assert.equal(g.current, null);
  assert.equal(g.reviewRequired, true);
  state.muse.slot.currentCredential = null;
  g = providerGroups([a, b], state, 1000)[0];
  assert.equal(g.current, null);
});
