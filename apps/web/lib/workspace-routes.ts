export type WorkspaceView = "markets" | "resources" | "tasks" | "agents" | "inbox" | "settings";

const paths: Record<WorkspaceView, string> = {
  markets: "/market",
  resources: "/resources",
  tasks: "/tasks",
  agents: "/agents",
  inbox: "/inbox",
  settings: "/settings",
};

export function workspaceHref(view: WorkspaceView): string {
  return paths[view];
}

export function workspaceView(pathname: string): WorkspaceView | null {
  if (pathname === "/") return "markets";
  return (Object.keys(paths) as WorkspaceView[]).find((view) => paths[view] === pathname) ?? null;
}
