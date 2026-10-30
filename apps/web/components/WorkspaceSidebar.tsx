"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { AccountControls } from "@/components/AccountControls";
import styles from "./WorkspaceSidebar.module.css";

export type WorkspaceView = "markets" | "resources" | "tasks" | "agents" | "inbox" | "settings";

function NavigationIcon({ view }: { view: WorkspaceView }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {view === "markets" ? (
        <>
          <path d="M4 19.5h16M5.5 15V9m6.5 6V4m6.5 11V7" />
          <path d="m3 7 5-3 5 3 7-5" />
        </>
      ) : view === "agents" ? (
        <>
          <rect x="4" y="7" width="16" height="13" rx="3" />
          <path d="M12 3v4M8 12h.01M16 12h.01M8 16h8M2 12h2m16 0h2" />
        </>
      ) : view === "tasks" ? (
        <>
          <rect x="5" y="4" width="14" height="17" rx="2" />
          <path d="M9 3h6v3H9zM8 11h8M8 15h5" />
        </>
      ) : view === "inbox" ? (
        <>
          <path d="M4 5h16v14H4zM4 13h5l2 3h2l2-3h5" />
          <path d="M8 9h8" />
        </>
      ) : view === "resources" ? (
        <>
          <path d="M3 7h7l2 2h9v11H3z" />
          <path d="M3 7V4h7l2 3m0 5v5m-2.5-2.5h5" />
        </>
      ) : (
        <>
          <path d="m9.5 3-.6 2.2-2 .9-2-.7-2.4 4.2 1.6 1.5v2.2l-1.6 1.5 2.4 4.1 2-.7 2 .9.6 2.2h5l.6-2.2 2-.9 2 .7 2.4-4.1-1.6-1.5v-2.2l1.6-1.5-2.4-4.2-2 .7-2-.9L14.5 3z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function WorkspaceSidebar({
  activeView,
  onNavigate,
}: {
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const t = useTranslations();
  const [collapsed, setCollapsed] = useState(true);
  const [compactScreen, setCompactScreen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const compact = compactScreen ? !mobileOpen : collapsed;
  const modal = compactScreen && mobileOpen;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const update = () => {
      setCompactScreen(media.matches);
      setMobileOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!modal) return;
    const content = document.getElementById("workspace-content");
    const wasInert = content?.hasAttribute("inert");
    const previousOverflow = document.body.style.overflow;
    content?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    return () => {
      if (!wasInert) content?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
    };
  }, [modal]);

  function closeMobile() {
    setMobileOpen(false);
    toggle.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobile();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      rail.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), summary") ?? [],
    ).filter((item) => item.offsetParent !== null);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <aside className={styles.slot} data-collapsed={compact} data-mobile-open={mobileOpen}>
      {modal && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label={t("nav.closeSidebar")}
          tabIndex={-1}
          onClick={closeMobile}
        />
      )}
      <div
        ref={rail}
        id="workspace-sidebar"
        className={styles.rail}
        role={modal ? "dialog" : undefined}
        aria-modal={modal || undefined}
        aria-label={modal ? t("nav.primary") : undefined}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.brandArea}>
          <a
            className={styles.brand}
            href="/"
            aria-label={t("nav.home")}
            title={compact ? "FolioView" : undefined}
          >
            <svg viewBox="0 0 32 32" fill="none" className={styles.brandMark} aria-hidden="true">
              <path d="M7 24V8h18M7 16h13" stroke="currentColor" strokeWidth="3" />
              <path d="m14 25 5-6 4 3 5-8" stroke="currentColor" strokeWidth="2" />
            </svg>
            <strong className={styles.label}>
              Folio<span>View</span>
            </strong>
          </a>
          <p className={`${styles.slogan} ${styles.label}`}>{t("nav.workspace")}</p>
          <button
            ref={toggle}
            type="button"
            className={styles.toggle}
            aria-expanded={!compact}
            aria-controls="workspace-sidebar"
            aria-label={t(compact ? "nav.expandSidebar" : "nav.collapseSidebar")}
            title={t(compact ? "nav.expandSidebar" : "nav.collapseSidebar")}
            onClick={() =>
              compactScreen ? setMobileOpen((value) => !value) : setCollapsed((value) => !value)
            }
          >
            <svg
              viewBox={compact ? "0 0 24 24" : "0 0 16 16"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              {compact ? (
                <>
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="M9 4v16m4-11 3 3-3 3" />
                </>
              ) : (
                <path d="m10 3-5 5 5 5" />
              )}
            </svg>
          </button>
        </div>
        <div className={styles.bottom}>
          <nav className={styles.navigation} aria-label={t("nav.primary")}>
            {(["markets", "resources", "tasks", "agents", "inbox", "settings"] as const).map(
              (view) => (
                <button
                  key={view}
                  type="button"
                  aria-label={t(`nav.${view}`)}
                  title={compact ? t(`nav.${view}`) : undefined}
                  aria-pressed={activeView === view}
                  className={styles.navItem}
                  onClick={() => {
                    onNavigate(view);
                    if (compactScreen) setMobileOpen(false);
                  }}
                >
                  <NavigationIcon view={view} />
                  <span className={styles.label}>{t(`nav.${view}`)}</span>
                </button>
              ),
            )}
          </nav>
          <AccountControls collapsed={compact} />
        </div>
      </div>
    </aside>
  );
}
