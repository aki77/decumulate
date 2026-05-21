export const toMan = (v: number) => v / 10000;

export function formatMan(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  return `${Math.round(toMan(yen)).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万円`;
}

export function formatManValue(manValue: number): string {
  return formatMan(manValue * 10000);
}

export function formatPercent(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(1)}%`;
}
