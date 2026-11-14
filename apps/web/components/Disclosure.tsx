"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./Disclosure.module.css";

export default function Disclosure({
  title,
  children,
  forceOpen = false,
  danger = false,
  onOpen,
}: {
  title: string;
  children: ReactNode;
  forceOpen?: boolean;
  danger?: boolean;
  onOpen?: () => void;
}) {
  const id = useId(),
    button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [mounted, setMounted] = useState(false);
  const expanded = forceOpen || open;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    if (forceOpen) {
      setMounted(true);
      setOpen(true);
      onOpenRef.current?.();
    }
  }, [forceOpen]);
  return (
    <section className={styles.disclosure} data-danger={danger}>
      <button
        ref={button}
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => {
          setMounted(true);
          if (!expanded) onOpenRef.current?.();
          if (!forceOpen) setOpen(!open);
        }}
      >
        <span>{title}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" data-open={expanded}>
          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div
        id={id}
        className={styles.content}
        data-open={expanded}
        inert={!expanded}
        aria-hidden={!expanded}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !forceOpen) {
            event.stopPropagation();
            setOpen(false);
            button.current?.focus();
          }
        }}
      >
        <div className={styles.inner}>{(expanded || mounted) && children}</div>
      </div>
    </section>
  );
}
