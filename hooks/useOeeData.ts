"use client";

import type { OeeData } from "@/components/oee/types";
import { useGlobalWeek } from "@/components/providers/GlobalWeekProvider";
import { useEffect, useRef, useState } from "react";

type UseOeeDataResult = {
  data: OeeData | null;
  error: string;
  loading: boolean;
  lastSync: Date | null;
  nextSync: Date | null;
};

function getNextOeeSyncDate(from: Date): Date {
  const syncAtSeven = new Date(from);
  syncAtSeven.setHours(7, 5, 0, 0);

  const syncAtNine = new Date(from);
  syncAtNine.setHours(9, 5, 0, 0);

  if (from < syncAtSeven) {
    return syncAtSeven;
  }

  if (from < syncAtNine) {
    return syncAtNine;
  }

  const nextHourlySync = new Date(from);
  nextHourlySync.setMinutes(5, 0, 0);

  if (nextHourlySync <= from) {
    nextHourlySync.setHours(nextHourlySync.getHours() + 1);
  }

  return nextHourlySync;
}

function buildOeeEndpoint(activeWeek: number): string {
  return `/api/oee?week=${encodeURIComponent(activeWeek)}`;
}

export default function useOeeData(): UseOeeDataResult {
  const { activeWeek, isWeekReady, weekError } = useGlobalWeek();

  const [data, setData] = useState<OeeData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [nextSync, setNextSync] = useState<Date | null>(null);

  const requestControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (weekError) {
      setError(weekError);
      setLoading(false);
      return;
    }

    if (!isWeekReady || activeWeek === null) {
      setLoading(true);
      return;
    }

    const selectedWeek = activeWeek;
    let cancelled = false;

    async function loadOee(showLoading: boolean): Promise<void> {
      requestControllerRef.current?.abort();

      const controller = new AbortController();
      requestControllerRef.current = controller;

      if (showLoading) {
        setLoading(true);
      }

      try {
        const response = await fetch(buildOeeEndpoint(selectedWeek), {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `No fue posible obtener la información de OEE. Código ${response.status}.`,
          );
        }

        const result = (await response.json()) as OeeData;

        if (cancelled) {
          return;
        }

        setData(result);
        setError("");
        setLastSync(new Date());
      } catch (err) {
        if (
          cancelled ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Ocurrió un error inesperado al cargar OEE.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    function scheduleNextSync(): void {
      const nextDate = getNextOeeSyncDate(new Date());
      setNextSync(nextDate);

      timeoutRef.current = setTimeout(async () => {
        await loadOee(false);

        if (!cancelled) {
          scheduleNextSync();
        }
      }, Math.max(nextDate.getTime() - Date.now(), 1000));
    }

    void loadOee(true).then(() => {
      if (!cancelled) {
        scheduleNextSync();
      }
    });

    return () => {
      cancelled = true;
      requestControllerRef.current?.abort();

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [activeWeek, isWeekReady, weekError]);

  return {
    data,
    error,
    loading,
    lastSync,
    nextSync,
  };
}
