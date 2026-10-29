import type { Period } from "@gratovo/core/insights";
import { useState } from "react";

import { InsightsScreen } from "./insights-screen";

/** Holds the period for the Insights screen. Copy summary does nothing until the reports are wired in. */
export function InsightsHost() {
  const [period, setPeriod] = useState<Period>("30d");
  return <InsightsScreen period={period} onPeriod={setPeriod} onCopySummary={() => undefined} />;
}
