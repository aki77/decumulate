// 年金の繰上げ/繰下げ係数と手取り計算
// 参考: 国民年金/厚生年金の繰上げ -0.4%/月、繰下げ +0.7%/月
// 手取り率はざっくり 85%（税・社保控除）想定

export const PENSION_NET_RATE = 0.85;

export function pensionMultiplier(startAge) {
  const clamped = Math.max(60, Math.min(75, startAge));
  const diffMonths = (clamped - 65) * 12;
  if (diffMonths < 0) return 1 + diffMonths * 0.004;
  return 1 + diffMonths * 0.007;
}

export function adjustedMonthlyPension(basePension, startAge) {
  const gross = basePension * pensionMultiplier(startAge);
  return Math.round(gross * PENSION_NET_RATE);
}
