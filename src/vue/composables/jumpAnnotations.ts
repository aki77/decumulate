import type { MonthlyProjection } from "../../calculate.ts";

const DEFAULT_JUMP_COLOR = "rgba(127, 29, 29, 0.95)";
const DEFAULT_JUMP_RADIUS = 6;

/** ジャンプ発生月を含む年(year)の配列を抽出（重複除去・ソート済み） */
export function extractJumpYears(monthly: MonthlyProjection[]): number[] {
  const years = new Set<number>();
  for (const m of monthly) {
    if (m.jumpOccurred) years.add(m.year);
  }
  return [...years].sort((a, b) => a - b);
}

/** 年次データセット長に合わせた pointRadius/pointBackgroundColor 配列を構築 */
export function buildJumpPointConfig(
  jumpYears: readonly number[],
  yearlyLength: number,
  options?: { radius?: number; color?: string },
) {
  const radius = options?.radius ?? DEFAULT_JUMP_RADIUS;
  const color = options?.color ?? DEFAULT_JUMP_COLOR;
  const jumpSet = new Set(jumpYears);
  const pointRadius = new Array<number>(yearlyLength).fill(0);
  const pointBackgroundColor = new Array<string>(yearlyLength).fill("transparent");
  for (let i = 0; i < yearlyLength; i++) {
    if (jumpSet.has(i)) {
      pointRadius[i] = radius;
      pointBackgroundColor[i] = color;
    }
  }
  return { pointRadius, pointBackgroundColor, pointStyle: "triangle" as const, pointRotation: 180 as const };
}
