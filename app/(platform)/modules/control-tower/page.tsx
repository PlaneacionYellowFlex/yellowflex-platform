"use client";

import OeeDashboard from "@/components/oee/OeeDashboard";
import GlobalWeekProvider from "@/components/providers/GlobalWeekProvider";

export default function ControlTowerPage() {
  return (
    <GlobalWeekProvider>
      <OeeDashboard />
    </GlobalWeekProvider>
  );
}
