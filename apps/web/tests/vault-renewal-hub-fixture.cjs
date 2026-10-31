// Actual released Hub producers plus SQLite, on stdin-only synthetic inputs.
// No SDK/cloud identity/network, real Passkeys or broker accounts are used.
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const python = path.join(root, "services/market-data-service/.venv/bin/python");
const SCRIPT = `import json,sys,tempfile
from pathlib import Path
from app.store import SQLiteHubStore
from app.vaults import VaultService
from app.vault_lifecycle import VaultLifecycleService
from app.key_renewals import VaultKeyRenewalService
from folioview_shared.encrypted.errors import ContractError
x=json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='folioview-renewal-adversarial-') as directory:
 clock=[1000]
 store=SQLiteHubStore(Path(directory)/'synthetic.sqlite3')
 vaults=VaultService(store,clock=lambda:clock[0])
 lifecycle=VaultLifecycleService(store,clock=lambda:clock[0])
 renewals=VaultKeyRenewalService(store,clock=lambda:clock[0])
 b=x['vault'];uid=x['uid'];contract=x['contract']
 vaults.bootstrap(uid,dict(contractVersion=contract,vaultId=b['vaultId'],rootJwk=b['rootJwk'],rootKeyId=b['rootKeyId'],registryBundle=b['registryHistory'][0],archive=b['archive']),'synthetic_renewal_bootstrap_0001')
 for index,bundle in enumerate(b['registryHistory'][1:],1):
  clock[0]=json.loads(__import__('base64').urlsafe_b64decode(bundle['checkpoint']['payload']+'=='))['issuedAt']
  vaults.update_registry(uid,b['vaultId'],dict(contractVersion=contract,expectedVersion=index,registryBundle=bundle),'synthetic_seed_registry_'+str(index).zfill(8))
 replies=[];errors=[]
 for action in x['actions']:
  clock[0]=action['now']
  packet=action['packet'];kind=action['kind'];actor=action.get('uid',uid)
  operation=action.get('operationId',packet['operationId'])
  try:
   if kind=='renewal':
    response=renewals.renew(actor,b['vaultId'],packet['body'],operation)
   elif kind=='receipt':
    response=renewals.receipt(actor,b['vaultId'],operation)
   elif kind=='archive_replace':
    body=packet.get('body',packet)
    response=lifecycle.replace_archive(actor,b['vaultId'],dict(contractVersion=contract,archive=body['archive'],command=body['command']),operation)
   else:raise AssertionError('Unknown fixture action')
   if action.get('expectError'):raise AssertionError('Expected rejected mutation')
   replies.append(dict(kind=kind,operationId=operation,response=response))
  except ContractError as error:
   if not action.get('expectError'):raise
   errors.append(error.code)
 clock[0]=x['now']
 print(json.dumps(dict(vault=vaults.current(uid)['vault'],state=lifecycle.state(uid,b['vaultId']),renewalState=renewals.state(uid,b['vaultId']),replies=replies,errors=errors)))`;

function actualHub(t, h, seed, actions = [], now = 1000) {
  if (!existsSync(python)) {
    t.skip("Declared shared Python environment unavailable");
    return null;
  }
  const result = spawnSync(python, ["-c", SCRIPT], {
    cwd: path.join(root, "services/agent-hub-service"),
    env: { ...process.env, PYTHONPATH: path.join(root, "services/common") },
    input: JSON.stringify({
      uid: seed.uid,
      vault: seed.vault,
      contract: h.core.CONTRACT,
      actions,
      now,
    }),
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const action = (kind, packet, now, extra = {}) => ({ kind, packet, now, ...extra });
module.exports = { actualHub, action };
