// 年金の繰上げ/繰下げ係数と手取り計算
// 参考: 国民年金/厚生年金の繰上げ -0.4%/月、繰下げ +0.7%/月
// 手取り率はざっくり 85%（税・社保控除）想定

export const PENSION_NET_RATE: number = 0.85;

export function pensionMultiplier(startAge: number): number {
  const clamped = Math.max(60, Math.min(75, startAge));
  const diffMonths = (clamped - 65) * 12;
  if (diffMonths < 0) return 1 + diffMonths * 0.004;
  return 1 + diffMonths * 0.007;
}

// 公的年金等控除の合算枠消費量として使うため、繰上げ/繰下げ反映後の「税・社保控除前」月額を返す。
export function grossMonthlyPension(basePension: number, startAge: number): number {
  return basePension * pensionMultiplier(startAge);
}

export function adjustedMonthlyPension(basePension: number, startAge: number): number {
  return Math.round(grossMonthlyPension(basePension, startAge) * PENSION_NET_RATE);
}
