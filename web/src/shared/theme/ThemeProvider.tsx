import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const storageKey = "lawata-theme";
const darkQuery = "(prefers-color-scheme: dark)";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme | null {
  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" ? stored : null;
}

function systemTheme(): Theme {
  return window.matchMedia?.(darkQuery).matches ? "dark" : "light";
}

// Follows prefers-color-scheme until the user picks a theme; the pick is stored and set as data-theme.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<Theme | null>(readStoredTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = override ?? system;

  useEffect(() => {
    const media = window.matchMedia?.(darkQuery);
    if (media === undefined) return;
    const onChange = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (override === null) {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", override);
      window.localStorage.setItem(storageKey, override);
    }
  }, [override]);

  const toggle = useCallback(() => setOverride(theme === "dark" ? "light" : "dark"), [theme]);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
