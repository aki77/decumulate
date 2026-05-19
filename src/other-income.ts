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
  startYearOffset: number;
  endYearOffset: number;
}

// currentAge ありなら年齢、なしなら経過年（0=現在）として解釈。
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
    const endYearOffset = e.endAge == null
      ? totalYears
      : Math.max(startYearOffset, toYearOffset(e.endAge, currentAge));
    if (startYearOffset >= totalYears) continue;
    if (endYearOffset <= startYearOffset) continue;
    result.push({ monthlyAmount, startYearOffset, endYearOffset });
  }
  return result;
}

// elapsed（0-based 経過年）で有効な月額の合計。calculate / monte-carlo で共有。
export function sumOtherIncomeAt(
  otherIncomes: OtherIncomeMonthly[],
  elapsed: number,
): number {
  let sum = 0;
  for (let k = 0; k < otherIncomes.length; k++) {
    const e = otherIncomes[k]!;
    if (elapsed >= e.startYearOffset && elapsed < e.endYearOffset) sum += e.monthlyAmount;
  }
  return sum;
}
