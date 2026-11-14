// Deterministic hook/component lifecycle; transports and Worker proofs remain explicit at each test.
function hooks() {
  let index = 0,
    dirty = false,
    mounted = true;
  const cells = [],
    effects = [];
  const changed = (a, b) => !a || !b || b.some((v, i) => v !== a[i]);
  const react = {
    useState(initial) {
      const i = index++;
      cells[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        cells[i].value,
        (next) => {
          if (!mounted) return;
          const value = typeof next === "function" ? next(cells[i].value) : next;
          dirty ||= value !== cells[i].value;
          cells[i].value = value;
        },
      ];
    },
    useRef(initial) {
      const i = index++;
      return (cells[i] ??= { current: initial });
    },
    useCallback(value, deps) {
      const i = index++;
      if (!cells[i] || changed(cells[i].deps, deps)) cells[i] = { value, deps };
      return cells[i].value;
    },
    useEffect(effect, deps) {
      const i = index++;
      if (!cells[i] || changed(cells[i].deps, deps)) effects.push({ i, effect, deps });
    },
  };
  return {
    react,
    render(action) {
      let value,
        turns = 0;
      do {
        if (++turns > 40) throw Error("render loop");
        index = 0;
        dirty = false;
        value = action();
        for (const { i, effect, deps } of effects.splice(0)) {
          cells[i]?.cleanup?.();
          cells[i] = { deps, cleanup: effect() };
        }
      } while (dirty);
      return value;
    },
    close() {
      mounted = false;
      for (const cell of cells) cell?.cleanup?.();
    },
  };
}
const jsx = (type, props, key) => ({ type, props, key });
function all(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((node) => all(node, predicate));
  return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)];
}
module.exports = { hooks, jsx, all };
