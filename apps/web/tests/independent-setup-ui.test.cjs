const assert = require("node:assert/strict");
const test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
test("Owner setup UI stays hidden while locked, requires public file review and never starts live work on preparation", async () => {
  const slots = [];
  let cursor = 0;
  const calls = [],
    network = [];
  const state = (initial) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [
      slots[i],
      (v) => {
        slots[i] = typeof v === "function" ? v(slots[i]) : v;
      },
    ];
  };
  const jsx = (type, props) => ({ type, props });
  const component = compile(
    "../components/IndependentSetupPanel.tsx",
    {
      react: {
        useState: state,
        useRef: (v) => state(() => ({ current: v }))[0],
        useEffect: () => {},
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next-intl": { useLocale: () => "en" },
      "./AuthProvider": {
        useAuth: () => ({
          requestPrivate: (...a) => {
            network.push(a);
            throw Error("unexpected");
          },
        }),
      },
      "@/lib/independent-agent": {
        INDEPENDENT_CONTRACT: "folioview.agent-workspace.v2.0",
      },
      "./IndependentSetupPanel.module.css": {},
    },
    { setTimeout, clearTimeout, structuredClone },
  );
  const workspace = {
    phase: "locked",
    canWriteState: false,
    owner: "owner_A",
    vaultGeneration: 1,
    prepareIndependentSetup: async (a) => {
      calls.push(a);
      return { domain: "a".repeat(64) };
    },
  };
  const render = () => {
    cursor = 0;
    return component.default({ workspace });
  };
  assert.equal(render(), null);
  workspace.phase = "unlocked";
  workspace.canWriteState = true;
  const all = (node, pred) =>
    !node || typeof node !== "object"
      ? []
      : [
          ...(pred(node) ? [node] : []),
          ...[node.props?.children].flat(Infinity).flatMap((c) => all(c, pred)),
        ];
  const button = (tree) =>
    all(tree, (n) => n.type === "button" && n.props.children === "Prepare and verify")[0];
  let tree = render();
  assert.equal(button(tree).props.disabled, true);
  const file = () => all(render(), (n) => n.type === "input" && n.props.type === "file")[0];
  await file().props.onChange({
    currentTarget: {
      files: [
        {
          size: 100,
          text: async () =>
            JSON.stringify({
              configuration: {},
              policyConfig: {},
              rootPrivateJwk: { d: "private" },
            }),
        },
      ],
      value: "",
    },
  });
  assert.equal(button(render()).props.disabled, true);
  assert.equal(calls.length, 0);
  const input = {
    configuration: {
      connectionId: "connection_A",
      clientId: "native_A",
      issuer: "https://policy.example",
    },
    policyConfig: {},
  };
  await file().props.onChange({
    currentTarget: {
      files: [{ size: 100, text: async () => JSON.stringify(input) }],
      value: "",
    },
  });
  tree = render();
  assert.equal(button(tree).props.disabled, true);
  all(tree, (n) => n.type === "input" && n.props.type === "checkbox")[0].props.onChange({
    target: { checked: true },
  });
  tree = render();
  assert.equal(button(tree).props.disabled, false);
  await button(tree).props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.action, "inspect");
  assert.equal(network.length, 0);
  workspace.phase = "locked";
  assert.equal(render(), null);
});
