const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createHarness, createOwner } = require("./full-flow-crypto-fixture.cjs");

let h;
test.before(async () => {
  h = await createHarness();
});
test.after(async () => {
  await h?.close();
});
const root = path.resolve(__dirname, "../../..");
const python = path.join(root, "services/market-data-service/.venv/bin/python");

function replacement() {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
  const prfSalt = h.core.b64(crypto.getRandomValues(new Uint8Array(32)));
  return () => ({ credentialId, prfSalt, secret: secret.slice().buffer });
}

function mutation(packet, action = "archive_replace", now = 1000) {
  return { ...packet, action, now };
}

// Every replay below runs the real producer against a new synthetic SQLite
// store. This helper never contacts a cloud endpoint or prints private keys.
function hub(t, f, mutations = [], now = 1000) {
  if (!existsSync(python)) {
    t.skip("Declared shared Python environment unavailable");
    return null;
  }
  const script = `import json,sys,tempfile
from pathlib import Path
from app.store import SQLiteHubStore
from app.vaults import VaultService
from app.vault_lifecycle import VaultLifecycleService
from folioview_shared.encrypted.errors import ContractError
x=json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='folioview-recovery-adversarial-') as d:
 clock=[1000];store=SQLiteHubStore(Path(d)/'synthetic.sqlite3');v=VaultService(store,clock=lambda:clock[0]);s=VaultLifecycleService(store,clock=lambda:clock[0]);b=x['vault'];uid=x['uid'];contract=x['contract']
 v.bootstrap(uid,dict(contractVersion=contract,vaultId=b['vaultId'],rootJwk=b['rootJwk'],rootKeyId=b['rootKeyId'],registryBundle=b['registryHistory'][0],archive=b['archive']),'synthetic_review_bootstrap_0001')
 receipts=[];errors=[]
 for p in x['mutations']:
  clock[0]=p['now'];body=dict(contractVersion=contract,command=p['command'])
  try:
   if p['action']=='archive_replace':
    body['archive']=p['archive'];r=s.replace_archive(uid,b['vaultId'],body,p['operationId'])
   elif p['action']=='recovery_authorize':r=s.authorize_recovery(uid,b['vaultId'],body,p['operationId'])
   else:r=s.revoke_recovery(uid,b['vaultId'],p['authorizationId'],body,p['operationId'])
   if p.get('expectError'):raise AssertionError('Expected conflict')
   receipts.append(r)
  except ContractError as e:
   if not p.get('expectError'):raise
   errors.append(e.code)
 clock[0]=x['now'];print(json.dumps(dict(vault=v.current(uid)['vault'],state=s.state(uid,b['vaultId']),receipts=receipts,errors=errors)))`;
  const result = spawnSync(python, ["-c", script], {
    cwd: path.join(root, "services/agent-hub-service"),
    env: { ...process.env, PYTHONPATH: path.join(root, "services/common") },
    input: JSON.stringify({
      uid: f.uid,
      vault: f.vault,
      contract: h.core.CONTRACT,
      mutations,
      now,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("lost original Passkey can resume an unapplied recovery with only the retained new Passkey", async (t) => {
  const f = await createOwner(h);
  const initial = hub(t, f);
  if (!initial) return;
  const kit = await f.session.createRecoveryKit(f.vault, initial.state);
  const restored = new h.core.VaultCore(f.uid, f.now);
  await restored.importRecoveryKit(f.vault, initial.state, kit.file, kit.code);
  const next = replacement();
  const candidate = await restored.prepareArchiveChange(f.vault, initial.state, next(), "recovery");
  const auth = mutation(candidate.packet.authorization, "recovery_authorize");
  const authorized = hub(t, f, [auth]);
  const fresh = new h.core.VaultCore(f.uid, f.now);
  const offer = await fresh.inspectArchiveChange(
    authorized.vault,
    authorized.state,
    candidate.record,
  );
  assert.equal(offer.archive.credentialId, next().credentialId);
  assert.deepEqual(
    await fresh.getArchiveChange(authorized.vault, authorized.state, candidate.record, next()),
    candidate.packet,
  );
  const complete = hub(t, f, [auth, mutation(candidate.packet)]);
  const done = await fresh.finishArchiveChange(
    complete.vault,
    complete.state,
    candidate.packet.operationId,
  );
  assert.equal(done.applied, true);
  assert.equal(done.needsDeviceRegistration, true);
});

test("a cancellation whose first witness applied can expire, resume and prevent every old write/replay", async (t) => {
  const f = await createOwner(h);
  const initial = hub(t, f);
  if (!initial) return;
  const candidate = await f.session.prepareArchiveChange(
    f.vault,
    initial.state,
    replacement()(),
    "passkey_change",
  );
  const cancellation = await f.session.prepareArchiveCancellation(
    f.vault,
    initial.state,
    candidate.record,
  );
  assert.equal(cancellation.packet.commands.length, 2);
  const first = mutation(cancellation.packet.commands[0], "recovery_authorize");
  const partial = hub(t, f, [first], 1301);
  assert.equal(partial.state.pendingAuthorization.status, "expired");
  f.time(1301);
  const resumed = await f.session.prepareArchiveCancellation(
    partial.vault,
    partial.state,
    cancellation.record,
  );
  assert.equal(resumed.packet.commands.length, 1);
  const revoke = mutation(resumed.packet.commands[0], "recovery_revoke", 1301);
  const complete = hub(
    t,
    f,
    [
      first,
      revoke,
      { ...first, now: 1302 },
      { ...mutation(candidate.packet, "archive_replace", 1302), expectError: true },
    ],
    1302,
  );
  assert.equal(complete.state.lifecycleVersion, 2);
  assert.equal(complete.state.pendingAuthorization, null);
  assert.deepEqual(complete.vault.archive, f.vault.archive);
  assert.equal(complete.errors.length, 1);
  await f.session.discardArchiveChange(
    complete.vault,
    complete.state,
    resumed.record,
    candidate.packet.operationId,
  );
});

test("cancellation rejects a public retained list grafted from a different recovery candidate", async (t) => {
  const f = await createOwner(h);
  const initial = hub(t, f);
  if (!initial) return;
  const unrelated = await f.session.prepareArchiveChange(
    f.vault,
    initial.state,
    replacement()(),
    "recovery",
  );
  const candidate = await f.session.prepareArchiveChange(
    f.vault,
    initial.state,
    replacement()(),
    "passkey_change",
  );
  const auth = mutation(unrelated.packet.authorization, "recovery_authorize");
  const current = hub(t, f, [auth]);
  const graft = {
    ...candidate.record,
    cancellation: {
      retained: [
        {
          operationId: auth.operationId,
          action: auth.action,
          authorizationId: auth.authorizationId,
          command: auth.command,
        },
      ],
    },
  };
  await assert.rejects(f.session.prepareArchiveCancellation(current.vault, current.state, graft));
});

test("public candidate inspection rejects a command/profile mismatch before asking for a Passkey", async (t) => {
  const f = await createOwner(h);
  const initial = hub(t, f);
  if (!initial) return;
  const candidate = await f.session.prepareArchiveChange(
    f.vault,
    initial.state,
    replacement()(),
    "passkey_change",
  );
  const forged = structuredClone(candidate.record);
  forged.packet.mode = "recovery";
  const fresh = new h.core.VaultCore(f.uid, f.now);
  await assert.rejects(fresh.inspectArchiveChange(f.vault, initial.state, forged));
  const wrongOwner = new h.core.VaultCore("synthetic_owner_B", f.now);
  await assert.rejects(wrongOwner.inspectArchiveChange(f.vault, initial.state, candidate.record));
});
