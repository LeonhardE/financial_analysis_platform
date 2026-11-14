"use client";

import {
  Component,
  Suspense,
  lazy,
  useMemo,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { InlineError, LoadingIndicator } from "./WorkspaceFeedback";

// Literal local imports keep private editors and chart code out of the initial shell.
const modules = {
  settings: () =>
    import("./SettingsPanel").then((m) => ({ default: m.default as ComponentType<any> })),
  resources: () =>
    import("./ResourcesPanel").then((m) => ({ default: m.default as ComponentType<any> })),
  tasks: () => import("./TasksPanel").then((m) => ({ default: m.default as ComponentType<any> })),
  agents: () =>
    import("./PersistentAgentsPanel").then((m) => ({
      default: m.PersistentAgentsPanel as ComponentType<any>,
    })),
  chart: () =>
    import("./CandlestickChart").then((m) => ({
      default: m.CandlestickChart as ComponentType<any>,
    })),
};

/** A stalled chunk becomes an in-place retry, without reloading the unlocked workspace. */
export async function loadWorkspaceModule<T>(
  load: () => Promise<T>,
  milliseconds = 15000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("module_unavailable")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class WorkspaceModuleBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Panel({
  name,
  panelProps,
}: {
  name: keyof typeof modules;
  panelProps: Record<string, any>;
}) {
  const t = useTranslations("workspaceFeedback");
  const [attempt, setAttempt] = useState(0);
  const Content = useMemo(() => lazy(() => loadWorkspaceModule(modules[name])), [name, attempt]);
  return (
    <WorkspaceModuleBoundary
      key={`${name}:${attempt}`}
      fallback={
        <InlineError
          message={t("moduleUnavailable")}
          retryLabel={t("retry")}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      }
    >
      <Suspense
        fallback={
          <div style={{ minBlockSize: 180 }}>
            <LoadingIndicator busy label={t("loading")} />
          </div>
        }
      >
        <Content {...panelProps} />
      </Suspense>
    </WorkspaceModuleBoundary>
  );
}
export function SettingsPanel(props: ComponentProps<typeof import("./SettingsPanel").default>) {
  return <Panel name="settings" panelProps={props ?? {}} />;
}
export function ResourcesPanel(props: ComponentProps<typeof import("./ResourcesPanel").default>) {
  return <Panel name="resources" panelProps={props ?? {}} />;
}
export function TasksPanel(props: ComponentProps<typeof import("./TasksPanel").default>) {
  return <Panel name="tasks" panelProps={props ?? {}} />;
}
export function PersistentAgentsPanel(
  props: ComponentProps<typeof import("./PersistentAgentsPanel").PersistentAgentsPanel>,
) {
  return <Panel name="agents" panelProps={props ?? {}} />;
}
export function CandlestickChart(
  props: ComponentProps<typeof import("./CandlestickChart").CandlestickChart>,
) {
  return <Panel name="chart" panelProps={props ?? {}} />;
}
