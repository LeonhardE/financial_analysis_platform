function panelStandins(imports) {
  return {
    SettingsPanel: imports["@/components/SettingsPanel"]?.default,
    ResourcesPanel: imports["@/components/ResourcesPanel"]?.default,
    TasksPanel: imports["@/components/TasksPanel"]?.default,
    PersistentAgentsPanel: imports["./PersistentAgentsPanel"]?.PersistentAgentsPanel,
    CandlestickChart: imports["@/components/CandlestickChart"]?.CandlestickChart,
  };
}
module.exports = { panelStandins };
