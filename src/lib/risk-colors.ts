// Pin colours + labels for the 4-level risk model (kept dependency-free).
export type RiskLevelName = "critical" | "high" | "medium" | "low";

export const RISK_PIN_COLORS: Record<RiskLevelName, string> = {
  critical: "#7f1d1d",
  high: "#dc2626",
  medium: "#f59e0b",
  low: "#16a34a",
};

export const RISK_LABELS: Record<RiskLevelName, string> = {
  critical: "วิกฤต",
  high: "เสี่ยงสูง",
  medium: "เสี่ยงกลาง",
  low: "เสี่ยงต่ำ",
};

/** Thresholds: critical ≥ 80, high 60–79.9, medium 25–59.9, low < 25 */
export const RISK_RANGE_LABELS: Record<RiskLevelName, string> = {
  critical: "≥ 80",
  high: "60–79.9",
  medium: "25–59.9",
  low: "< 25",
};

export function riskLevelOf(score: number): RiskLevelName {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 25) return "medium";
  return "low";
}

/** critical + high both need urgent attention. */
export function isUrgentRisk(level?: RiskLevelName | null) {
  return level === "critical" || level === "high";
}
