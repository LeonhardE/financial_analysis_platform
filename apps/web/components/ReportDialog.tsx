"use client";
import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import styles from "./WorkspaceFeedback.module.css";

export function ReportDialog({
  id,
  open,
  identity,
  title,
  closeLabel,
  onClose,
  children,
}: {
  id: string;
  open: boolean;
  identity: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null),
    closing = useRef(false);
  const live = useRef({ open, identity, onClose });
  live.current = { open, identity, onClose };
  const [leaving, setLeaving] = useState(false);
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    clearTimer();
    closing.current = false;
    setLeaving(false);
    const node = dialog.current;
    if (!node) return;
    if (!open) {
      node.close();
      return;
    }
    if (!node.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
    }
    return clearTimer;
  }, [open, identity]);
  useEffect(
    () => () => {
      clearTimer();
      dialog.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!open || !document.body) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);
  const requestClose = () => {
    if (!live.current.open || closing.current) return;
    const original = live.current.identity;
    closing.current = true;
    setLeaving(true);
    const finish = () => {
      timer.current = null;
      if (!live.current.open || live.current.identity !== original) return;
      dialog.current?.close();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      live.current.onClose();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else timer.current = window.setTimeout(finish, 160);
  };
  const keydown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const nodes = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea, [tabindex]",
      ),
    ).filter(
      (node) =>
        node.tabIndex >= 0 &&
        !("disabled" in node && node.disabled) &&
        node.getClientRects().length > 0,
    );
    if (!nodes.length) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <dialog
      ref={dialog}
      id={id}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      data-closing={leaving}
      onKeyDown={keydown}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        const node = dialog.current;
        if (!node || event.target !== node) return;
        const r = node.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          requestClose();
      }}
    >
      {open && (
        <>
          <header className={styles.dialogHeading}>
            <h2 id={`${id}-title`}>{title}</h2>
            <button type="button" autoFocus onClick={requestClose} aria-label={closeLabel}>
              ×
            </button>
          </header>
          <div className={styles.dialogBody}>{children}</div>
        </>
      )}
    </dialog>
  );
}
