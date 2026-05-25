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

/** 年次データセット長に合わせた pointRadius/pointBackgroundColor 配列を構築（汎用） */
export function buildPointAnnotationConfig(
  markerYears: readonly number[],
  yearlyLength: number,
  options: { radius?: number; color?: string; rotation?: number } = {},
) {
  const radius = options.radius ?? DEFAULT_JUMP_RADIUS;
  const color = options.color ?? DEFAULT_JUMP_COLOR;
  const rotation = options.rotation ?? 0;
  const markerSet = new Set(markerYears);
  const pointRadius = new Array<number>(yearlyLength).fill(0);
  const pointBackgroundColor = new Array<string>(yearlyLength).fill("transparent");
  const pointRotation = new Array<number>(yearlyLength).fill(0);
  for (let i = 0; i < yearlyLength; i++) {
    if (markerSet.has(i)) {
      pointRadius[i] = radius;
      pointBackgroundColor[i] = color;
      pointRotation[i] = rotation;
    }
  }
  return { pointRadius, pointBackgroundColor, pointStyle: "triangle" as const, pointRotation };
}

/** JD用（逆三角・暗赤）ポイント設定 */
export function buildJumpPointConfig(
  jumpYears: readonly number[],
  yearlyLength: number,
  options?: { radius?: number; color?: string },
) {
  return buildPointAnnotationConfig(jumpYears, yearlyLength, { ...options, rotation: 180 });
}
