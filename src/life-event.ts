export interface LifeEventEntry {
  id: string;
  label: string;
  amountMan: number;
  age: number;
}

export interface LifeEventAtYear {
  // 発火する year（1-based）。月次行の表示 age = currentAge + year なので、
  // yearOffset = age - currentAge にすれば「age 歳の年」にヒットする。
  yearOffset: number;
  amount: number;
  label: string;
}

export function normalizeLifeEvents(
  entries: LifeEventEntry[],
  currentAge: number | null,
  totalYears: number,
  yenPerMan: number,
): LifeEventAtYear[] {
  const result: LifeEventAtYear[] = [];
  for (const e of entries) {
    if (!(e.amountMan > 0)) continue;
    const yearOffset = currentAge != null ? e.age - currentAge : e.age;
    if (yearOffset < 1 || yearOffset > totalYears) continue;
    result.push({
      yearOffset,
      amount: e.amountMan * yenPerMan,
      label: e.label || "（無題）",
    });
  }
  return result;
}

// 同年に複数イベントがある場合は合算し label を連結して返す。該当なしは null。
export function sumLifeEventsAt(
  events: LifeEventAtYear[],
  yearOffset: number,
): { amount: number; label: string } | null {
  let total = 0;
  const labels: string[] = [];
  for (const e of events) {
    if (e.yearOffset === yearOffset) {
      total += e.amount;
      labels.push(e.label);
    }
  }
  if (total <= 0) return null;
  return { amount: total, label: labels.join(", ") };
}
