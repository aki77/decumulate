import type { MonthlyProjection } from "../../calculate.ts";
import { buildPointAnnotationConfig } from "./jumpAnnotations.ts";

const LIFE_EVENT_COLOR = "rgba(217, 119, 6, 0.95)";
const LIFE_EVENT_RADIUS = 6;

/** ライフイベント発生月を含む年(year)の配列を抽出（重複除去・ソート済み） */
export function extractLifeEventYears(monthly: MonthlyProjection[]): number[] {
  const years = new Set<number>();
  for (const m of monthly) {
    if (m.lifeEventInfo) years.add(m.year);
  }
  return [...years].sort((a, b) => a - b);
}

/** year → label のマップを構築（tooltip用）。同一年の最初のラベルを採用。 */
export function extractLifeEventInfo(monthly: MonthlyProjection[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of monthly) {
    if (m.lifeEventInfo && !map.has(m.year)) {
      map.set(m.year, m.lifeEventInfo.label);
    }
  }
  return map;
}

/** ライフイベント用（正立三角・橙）ポイント設定 */
export function buildLifeEventPointConfig(
  lifeEventYears: readonly number[],
  yearlyLength: number,
  options?: { radius?: number; color?: string },
) {
  return buildPointAnnotationConfig(lifeEventYears, yearlyLength, {
    ...options,
    color: options?.color ?? LIFE_EVENT_COLOR,
    radius: options?.radius ?? LIFE_EVENT_RADIUS,
    rotation: 0,
  });
}

/** JDマーカーとライフイベントマーカーを合成する。同一年はライフイベント優先（橙）。 */
export function mergePointAnnotations(
  jumpConfig: ReturnType<typeof buildPointAnnotationConfig>,
  lifeEventConfig: ReturnType<typeof buildPointAnnotationConfig>,
  yearlyLength: number,
) {
  const pointRadius = new Array<number>(yearlyLength).fill(0);
  const pointBackgroundColor = new Array<string>(yearlyLength).fill("transparent");
  const pointRotation = new Array<number>(yearlyLength).fill(0);
  for (let i = 0; i < yearlyLength; i++) {
    if ((lifeEventConfig.pointRadius[i] ?? 0) > 0) {
      pointRadius[i] = lifeEventConfig.pointRadius[i]!;
      pointBackgroundColor[i] = lifeEventConfig.pointBackgroundColor[i]!;
      pointRotation[i] = lifeEventConfig.pointRotation[i]!;
    } else if ((jumpConfig.pointRadius[i] ?? 0) > 0) {
      pointRadius[i] = jumpConfig.pointRadius[i]!;
      pointBackgroundColor[i] = jumpConfig.pointBackgroundColor[i]!;
      pointRotation[i] = jumpConfig.pointRotation[i]!;
    }
  }
  return { pointRadius, pointBackgroundColor, pointStyle: "triangle" as const, pointRotation };
}
