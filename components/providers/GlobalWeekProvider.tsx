"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type GlobalWeekContextValue = {
  activeWeek: number | null;
  availableWeeks: number[];
  isHydrated: boolean;
  isWeekReady: boolean;
  weekError: string;
  setActiveWeek: (week: number) => void;
  initializeActiveWeek: (availableWeeks: number[]) => void;
};

type GlobalWeekProviderProps = { children: ReactNode };
type OeeWeekResponse = { currentWeek: number; history: Array<{ week: number }> };
const STORAGE_KEY = "yellowflex-active-week";
const GlobalWeekContext = createContext<GlobalWeekContextValue | null>(null);

function isValidWeek(week: number): boolean {
  return Number.isInteger(week) && week >= 1 && week <= 53;
}

function normalizeAvailableWeeks(weeks: number[]): number[] {
  return Array.from(new Set(weeks)).filter(isValidWeek).sort((a, b) => a - b);
}

export default function GlobalWeekProvider({ children }: GlobalWeekProviderProps) {
  const [activeWeek, setActiveWeekState] = useState<number | null>(null);
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isWeekReady, setIsWeekReady] = useState(false);
  const [weekError, setWeekError] = useState("");

  useEffect(() => { setIsHydrated(true); }, []);

  const initializeActiveWeek = useCallback((weeks: number[]) => {
    const normalizedWeeks = normalizeAvailableWeeks(weeks);
    if (normalizedWeeks.length === 0) {
      setAvailableWeeks([]);
      setIsWeekReady(false);
      return;
    }

    const latestAvailableWeek = normalizedWeeks[normalizedWeeks.length - 1];
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    const storedWeek = storedValue === null ? null : Number(storedValue);
    const resolvedWeek =
      storedWeek !== null && isValidWeek(storedWeek) && normalizedWeeks.includes(storedWeek)
        ? storedWeek
        : latestAvailableWeek;

    setAvailableWeeks(normalizedWeeks);
    setActiveWeekState(resolvedWeek);
    window.localStorage.setItem(STORAGE_KEY, String(resolvedWeek));
    setIsWeekReady(true);
    setWeekError("");
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadAvailableWeeks(): Promise<void> {
      try {
        setIsWeekReady(false);
        setWeekError("");
        const response = await fetch("/api/oee", { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          throw new Error(`No fue posible obtener las semanas disponibles. Código ${response.status}.`);
        }
        const result = (await response.json()) as OeeWeekResponse;
        if (cancelled) return;
        const historyWeeks = result.history.map((record) => record.week);
        initializeActiveWeek(historyWeeks.length > 0 ? historyWeeks : [result.currentWeek]);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setIsWeekReady(false);
        setWeekError(error instanceof Error ? error.message : "Ocurrió un error al validar la semana activa.");
      }
    }

    void loadAvailableWeeks();
    return () => { cancelled = true; controller.abort(); };
  }, [initializeActiveWeek, isHydrated]);

  const setActiveWeek = useCallback((week: number) => {
    if (!isValidWeek(week) || !availableWeeks.includes(week)) return;
    setActiveWeekState(week);
    window.localStorage.setItem(STORAGE_KEY, String(week));
  }, [availableWeeks]);

  const value = useMemo<GlobalWeekContextValue>(() => ({
    activeWeek, availableWeeks, isHydrated, isWeekReady, weekError,
    setActiveWeek, initializeActiveWeek,
  }), [activeWeek, availableWeeks, initializeActiveWeek, isHydrated, isWeekReady, setActiveWeek, weekError]);

  return <GlobalWeekContext.Provider value={value}>{children}</GlobalWeekContext.Provider>;
}

export function useGlobalWeek(): GlobalWeekContextValue {
  const context = useContext(GlobalWeekContext);
  if (!context) throw new Error("useGlobalWeek debe utilizarse dentro de GlobalWeekProvider.");
  return context;
}
