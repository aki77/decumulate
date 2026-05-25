export type OtherIncomeAmountMode = "monthly" | "annual";

export interface OtherIncomeEntry {
  id: string;
  label: string;
  amountMan: number;
  amountMode: OtherIncomeAmountMode;
  startAge: number | null;
  endAge: number | null;
}

export interface OtherIncomeMonthly {
  monthlyAmount: number;
  // 発火する year（1-based）の範囲。両端 inclusive。
  // start=0 は startAge ≤ currentAge のクランプ結果で、year=1 から発火する。
  startYearOffset: number;
  endYearOffset: number;
}

// startAge ≤ currentAge は 0 にクランプして「現在以前から続いている収入」を表現する。
function toYearOffset(age: number | null, currentAge: number | null): number {
  if (age == null) return 0;
  const base = currentAge != null ? age - currentAge : age;
  return Math.max(0, base);
}

export function normalizeOtherIncomes(
  entries: OtherIncomeEntry[],
  currentAge: number | null,
  totalYears: number,
  yenPerMan: number,
): OtherIncomeMonthly[] {
  const result: OtherIncomeMonthly[] = [];
  for (const e of entries) {
    const monthlyAmount =
      e.amountMode === "annual" ? (e.amountMan * yenPerMan) / 12 : e.amountMan * yenPerMan;
    if (!(monthlyAmount > 0)) continue;
    const startYearOffset = toYearOffset(e.startAge, currentAge);
    if (startYearOffset >= totalYears) continue;
    let endYearOffset: number;
    if (e.endAge == null) {
      endYearOffset = totalYears;
    } else {
      const rawEnd = toYearOffset(e.endAge, currentAge);
      // 期間逆転（endAge < startAge）は除外。start==end は 1 年限定として残す（inclusive 比較）。
      if (e.startAge != null && e.endAge < e.startAge) continue;
      endYearOffset = Math.max(startYearOffset, rawEnd);
    }
    result.push({ monthlyAmount, startYearOffset, endYearOffset });
  }
  return result;
}

export function sumOtherIncomeAt(
  otherIncomes: OtherIncomeMonthly[],
  year: number,
): number {
  let sum = 0;
  for (let k = 0; k < otherIncomes.length; k++) {
    const e = otherIncomes[k]!;
    if (year >= e.startYearOffset && year <= e.endYearOffset) sum += e.monthlyAmount;
  }
  return sum;
}
