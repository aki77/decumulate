export const MAN = 10000;
export const toMan = (v: number) => v / MAN;

export function formatMan(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  return `${Math.round(toMan(yen)).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万円`;
}

export function formatManValue(manValue: number): string {
  return formatMan(manValue * MAN);
}

export function formatPercent(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatNumber(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}
