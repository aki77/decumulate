const COLOR_CONTRIB_END = "rgba(34, 197, 94, 0.6)";
const COLOR_WITHDRAW_START = "rgba(239, 68, 68, 0.6)";

function verticalLine(year: number, color: string, label: string): Record<string, unknown> {
  return {
    type: "line",
    xMin: year,
    xMax: year,
    borderColor: color,
    borderWidth: 2,
    borderDash: [6, 6],
    label: { display: true, content: label, position: "start" },
  };
}

export type PhaseMarkerInput = {
  contributionYears: number;
  withdrawalStartYear: number;
  maxYear: number;
};

export function buildPhaseAnnotations(input: PhaseMarkerInput): Record<string, unknown> {
  const { contributionYears, withdrawalStartYear, maxYear } = input;
  const showContrib = contributionYears > 0 && contributionYears <= maxYear;
  const showWithdraw = withdrawalStartYear > 0 && withdrawalStartYear <= maxYear;
  const annotations: Record<string, unknown> = {};

  if (showContrib && showWithdraw && contributionYears === withdrawalStartYear) {
    annotations["phaseShift"] = verticalLine(withdrawalStartYear, COLOR_WITHDRAW_START, "積立終了 / 切崩開始");
    return annotations;
  }

  if (showContrib) {
    annotations["contribEnd"] = verticalLine(contributionYears, COLOR_CONTRIB_END, "積立終了");
  }
  if (showWithdraw) {
    annotations["withdrawStart"] = verticalLine(withdrawalStartYear, COLOR_WITHDRAW_START, "切崩開始");
  }
  return annotations;
}
