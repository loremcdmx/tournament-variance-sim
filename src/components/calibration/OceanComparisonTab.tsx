"use client";

import profile from "@/lib/calibration/space-runtime-profile.json";
import bridge from "@/lib/calibration/ocean-bridge-profile.json";
import type { PublicSpaceProfile } from "@/lib/calibration/types";
import type { EmpiricalBridgeData } from "@/lib/calibration/oceanTransport";
import type { Locale } from "@/lib/i18n/dict";
import { OceanComparisonReport } from "./OceanComparisonReport";

export function OceanComparisonTab({ locale, active }: { locale: Locale; active: boolean }) {
  return <OceanComparisonReport profile={profile as PublicSpaceProfile} bridge={bridge as EmpiricalBridgeData} locale={locale} active={active} />;
}
