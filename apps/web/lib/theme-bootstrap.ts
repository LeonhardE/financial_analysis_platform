/** A display hint only. Config remains authoritative; no account or private data is stored. */
export type ThemePreference = "system" | "light" | "dark";
export const THEME_HINT_KEY = "folioview.theme.v1";

export function readThemeHint(): ThemePreference | null {
  try {
    const theme = window.localStorage.getItem(THEME_HINT_KEY);
    return theme === "system" || theme === "light" || theme === "dark" ? theme : null;
  } catch {
    return null;
  }
}

export function writeThemeHint(theme: ThemePreference | null) {
  try {
    if (theme === null) window.localStorage.removeItem(THEME_HINT_KEY);
    else window.localStorage.setItem(THEME_HINT_KEY, theme);
  } catch {
    // Restricted storage must not block rendering or account preference requests.
  }
}

// Runs in the head before body paint, independently of React, Firebase and Config.
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{let t="system";try{const h=localStorage.getItem("${THEME_HINT_KEY}");if(h==="light"||h==="dark"||h==="system")t=h}catch{}const d=t==="system"?matchMedia("(prefers-color-scheme: dark)").matches:t==="dark";const r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light"})()`;
