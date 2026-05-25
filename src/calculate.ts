// 決定論的な複利 + 取り崩しシミュレーション
// 月次ループで運用 -> 積立 -> 取り崩し -> 損益按分課税 の順に処理する
// 口座構造: NISA(非課税) / 特定リスク(課税) / 防衛(課税) の3バケット + iDeCo（独立バケット）
import { adjustedMonthlyPension, grossMonthlyPension } from "./pension.ts";
import { sumOtherIncomeAt, type OtherIncomeMonthly } from "./other-income.ts";
import { sumLifeEventsAt, type LifeEventAtYear } from "./life-event.ts";
import {
  initIdecoState,
  stepIdeco,
  idecoReceiveStartYearOffset,
  idecoReceiveAge as computeIdecoReceiveAge,
  type IdecoParams,
  type IdecoPayoutEvent,
} from "./ideco.ts";

export const TAX_RATE = 0.20315;

// NISA成長投資枠の年間/生涯上限（円）
export const NISA_ANNUAL_LIMIT = 3_600_000;
export const NISA_LIFETIME_LIMIT = 18_000_000;

export interface CalculateParams {
  // 初期化(口座 × 金額/含み益)
  initialNisa: number;
  initialNisaGain: number;
  initialTaxableRisk: number;
  initialTaxableRiskGain: number;
  initialDefense: number;
  initialDefenseGain: number;

  // 積立・運用
  monthlyContribution: number;
  annualReturnRate: number;
  expenseRatio: number;
  inflationRate: number;

  // 期間
  contributionYears: number;
  withdrawalStartYear: number;
  withdrawalYears: number;

  // 取り崩し
  withdrawalMode: "amount" | "rate" | "rate-risk" | "rate-guardrail" | "zero-landing";
  fixedMonthlyWithdrawal: number;
  withdrawalRate: number;
  guardrailUpperPercent: number;
  guardrailLowerPercent: number;
  guardrailAdjustmentPercent: number;
  // 年率モード時の月額下限/上限。年齢ステップ式。各行 untilAge までその floor/ceiling を採用、
  // 末尾行は untilAge=null（以降ずっと）。値は円・実質値（呼び出し側で名目化）。
  withdrawalLimitSchedule: WithdrawalLimitStep[];
  inflationAdjustedWithdrawal: boolean;

  // 年金・他収入
  basePension: number;
  pensionStartAge: number;
  currentAge: number;
  otherIncomes: OtherIncomeMonthly[];
  lifeEvents: LifeEventAtYear[];

  // 防衛資産
  defenseAnnualReturnRate: number;
  targetDefenseRatioStart: number;
  targetDefenseRatioEnd: number;
  glidePathEndAge: number;
  rebalanceThresholdPoint: number;
  defensePriorityOnDrawdown: boolean;

  // NISA枠
  isCoupled: boolean;
  nisaTransferEnabled: boolean;
  nisaInitialLifetimeUsed: number;

  // iDeCo（個人型確定拠出年金）。idecoEnabled=false の場合は無視。
  idecoEnabled: boolean;
  ideco: IdecoParams;

  // DIE WITH ZERO 動的取り崩し。withdrawalMode==="zero-landing" の場合のみ使用。
  zeroLandingCurve?: ZeroLandingCurve;
}

export interface YearlyProjection {
  year: number;
  age: number;
  principal: number;
  interest: number;
  tax: number;
  total: number;
  yearlyWithdrawal: number;
  yearlyPension: number;
  yearlyOtherIncome: number;
  nisaTotal: number;
  taxableRiskTotal: number;
  defenseTotal: number;
  idecoTotal: number;
  nisaLifetimeUsed: number;
  yearlyIdecoLumpSum: number;
  yearlyIdecoPension: number;
}

export interface RebalanceInfo {
  direction: "risk-to-defense" | "defense-to-risk";
  sellAmount: number;
  taxAmount: number;
  proceeds: number;
  nisaUsed: number;
}

export interface NisaTransferInfo {
  sellAmount: number;
  taxAmount: number;
  proceeds: number;
}

export interface MonthlyProjection {
  year: number;
  month: number;
  age: number;
  nisaTotal: number;
  taxableRiskTotal: number;
  riskTotal: number;
  defenseTotal: number;
  idecoTotal: number;
  total: number;
  monthlyWithdrawal: number;
  monthlyWithdrawalNisa: number;
  monthlyWithdrawalTaxableRisk: number;
  monthlyWithdrawalDefense: number;
  monthlyWithdrawalTaxTaxableRisk: number;
  monthlyWithdrawalTaxDefense: number;
  baseWithdrawal: number;
  rateWithdrawalBasis: number | null;
  monthlyPension: number;
  monthlyOtherIncome: number;
  monthlyGainRisk: number;
  monthlyGainNisa: number;
  monthlyGainTaxableRisk: number;
  monthlyGainDefense: number;
  monthlyGainIdeco: number;
  monthlyGain: number;
  monthlyRate: number;
  monthlyRateRisk: number;
  rebalanceInfo: RebalanceInfo | null;
  nisaTransferInfo: NisaTransferInfo | null;
  idecoLumpSumInfo: IdecoPayoutEvent | null;
  idecoPensionInfo: IdecoPayoutEvent | null;
  /** Mertonジャンプ拡散有効時に、この月にジャンプが発生したことを示す。決定論版・JD無効時・非pivotパスでは undefined。 */
  jumpOccurred?: boolean;
  /** ライフイベント発生月のみ付与。その月の一時支出情報。 */
  lifeEventInfo?: { amount: number; label: string };
}

export interface CompoundResult {
  yearly: YearlyProjection[];
  monthly: MonthlyProjection[];
}

// 年率モード時の月額下限/上限の年齢ステップ。
// - untilAge=null は終端行（その年齢以降ずっと採用）。配列の末尾に 1 行だけ存在する。
// - floor/ceiling=null はその区間で制限なしを意味する。
// - 値の単位は円・実質値（現在の購買力基準）。決定論版では年初に *= (1+ri) で名目化する。
export interface WithdrawalLimitStep {
  untilAge: number | null;
  floor: number | null;
  ceiling: number | null;
}

export interface ZeroLandingCurve {
  slowGoStartAge: number;
  noGoStartAge: number;
  slowGoCoef: number;
  noGoMonthly: number;
}

// age に対応する floor/ceiling を取得。schedule は untilAge 昇順を想定するが、未ソートでも
// 「age <= untilAge で最初に一致した行、無ければ末尾」で安全に解決する。
export function findLimitForAge(
  schedule: WithdrawalLimitStep[],
  age: number,
): { floor: number | null; ceiling: number | null } {
  if (schedule.length === 0) return { floor: null, ceiling: null };
  for (const step of schedule) {
    if (step.untilAge !== null && age <= step.untilAge) {
      return { floor: step.floor, ceiling: step.ceiling };
    }
  }
  const last = schedule[schedule.length - 1]!;
  return { floor: last.floor, ceiling: last.ceiling };
}

// 年率モード時の月額下限/上限クランプ。null は無効を意味する。
export function clampToBounds(
  value: number,
  floor: number | null,
  ceiling: number | null,
): number {
  let v = value;
  if (floor !== null && v < floor) v = floor;
  if (ceiling !== null && v > ceiling) v = ceiling;
  return v;
}

// 1バケットから amount を取り崩し、含み益按分課税分も合わせて控除する。
export function withdrawFromBucket(
  total: number,
  principal: number,
  amount: number,
  taxRate: number,
): [number, number] {
  if (amount <= 0 || total <= 0) return [total, principal];
  const gainRatio = total > principal ? (total - principal) / total : 0;
  const tax = amount * gainRatio * taxRate;
  const ratio = Math.min(amount / total, 1);
  const newPrincipal = principal * (1 - ratio);
  const newTotal = Math.max(total - amount - tax, 0);
  return [newTotal, newPrincipal];
}

// 取り崩し額を時価比率で2バケットに按分し、片方が枯渇した場合は他方で補う。
export function splitProportional(
  amount: number,
  riskTotal: number,
  defenseTotal: number,
): [number, number] {
  const total = riskTotal + defenseTotal;
  if (amount <= 0 || total <= 0) return [0, 0];
  let fromRisk = amount * (riskTotal / total);
  let fromDefense = amount * (defenseTotal / total);
  if (fromRisk > riskTotal) {
    fromDefense += fromRisk - riskTotal;
    fromRisk = riskTotal;
  }
  if (fromDefense > defenseTotal) {
    fromRisk += fromDefense - defenseTotal;
    fromDefense = defenseTotal;
  }
  return [fromRisk, fromDefense];
}

// リスク資産から優先取り崩し。リスクが足りない場合は不足分を防衛から補う。
export function splitRiskFirst(
  amount: number,
  riskTotal: number,
  defenseTotal: number,
): [number, number] {
  if (amount <= 0) return [0, 0];
  const fromRisk = Math.min(amount, Math.max(riskTotal, 0));
  const fromDefense = Math.min(amount - fromRisk, Math.max(defenseTotal, 0));
  return [fromRisk, fromDefense];
}

// リスクサイド取り崩しを 特定リスク → NISA の順に分解。NISAは最後に触る。
export function splitRiskSide(
  amount: number,
  taxableRiskTotal: number,
  nisaTotal: number,
): [number, number] {
  if (amount <= 0) return [0, 0];
  const fromTaxable = Math.min(amount, Math.max(taxableRiskTotal, 0));
  const fromNisa = Math.min(amount - fromTaxable, Math.max(nisaTotal, 0));
  return [fromTaxable, fromNisa];
}

// 月末時点の防衛資産比率が目標から thresholdPoint（pt）以上乖離していたらリバランス発動。
export function needsRebalance(
  riskTotal: number,
  defenseTotal: number,
  defenseRatio: number,
  thresholdPoint: number,
): boolean {
  const total = riskTotal + defenseTotal;
  if (total <= 0) return false;
  const currentRatio = defenseTotal / total;
  return Math.abs(currentRatio - defenseRatio) * 100 > thresholdPoint;
}

export interface TriBucketsState {
  nisaTotal: number;
  nisaPrincipal: number;
  taxableRiskTotal: number;
  taxableRiskPrincipal: number;
  defenseTotal: number;
  defensePrincipal: number;
}

export interface RebalanceTriResult {
  state: TriBucketsState;
  info: RebalanceInfo | null;
}

export function resolveDefenseRatio(
  ageThisYear: number,
  currentAge: number,
  startPercent: number,
  endPercent: number,
  endAge: number,
): number {
  const startDr = Math.max(0, Math.min(1, startPercent / 100));
  const endDr = Math.max(0, Math.min(1, endPercent / 100));
  if (endAge <= currentAge) return endDr;
  if (ageThisYear <= currentAge) return startDr;
  if (ageThisYear >= endAge) return endDr;
  const t = (ageThisYear - currentAge) / (endAge - currentAge);
  return startDr + (endDr - startDr) * t;
}

// 3バケット用リバランス。
// - 売却方向（リスクサイド過大 → 防衛買付）: 特定リスクから優先売却、不足分のみNISAから（NISA売却は非課税）。
// - 買付方向（防衛過大 → リスクサイド買付）: 防衛から売却、税引後proceedsをNISA枠残優先で充当、超過分は特定リスクへ。
export function rebalanceTriBuckets(
  state: TriBucketsState,
  defenseRatio: number,
  taxRate: number,
  nisaRemainAnnual: number,
  nisaRemainLifetime: number,
  idecoTotal: number = 0,
): RebalanceTriResult {
  const {
    nisaTotal,
    nisaPrincipal,
    taxableRiskTotal,
    taxableRiskPrincipal,
    defenseTotal,
    defensePrincipal,
  } = state;
  const liquidRiskSide = nisaTotal + taxableRiskTotal;
  const total = liquidRiskSide + defenseTotal + idecoTotal;
  if (total <= 0) return { state, info: null };
  const delta = defenseRatio * total - defenseTotal;
  if (delta === 0) return { state, info: null };

  if (delta > 0) {
    // iDeCo は直接売却不可なので売却対象は NISA/特定のみ
    const sellRequested = Math.min(delta, liquidRiskSide);
    const [sellFromTaxable, sellFromNisa] = splitRiskSide(
      sellRequested,
      taxableRiskTotal,
      nisaTotal,
    );

    const [newTaxableRiskTotal, newTaxableRiskPrincipal] = withdrawFromBucket(
      taxableRiskTotal,
      taxableRiskPrincipal,
      sellFromTaxable,
      taxRate,
    );
    const [newNisaTotal, newNisaPrincipal] = withdrawFromBucket(
      nisaTotal,
      nisaPrincipal,
      sellFromNisa,
      0,
    );
    // withdrawFromBucket: newTotal = total - sell - tax なので tax = total - newTotal - sell
    const taxTaxable = taxableRiskTotal - newTaxableRiskTotal - sellFromTaxable;
    const proceedsTaxable = sellFromTaxable - taxTaxable;
    const proceeds = proceedsTaxable + sellFromNisa;

    return {
      state: {
        nisaTotal: newNisaTotal,
        nisaPrincipal: newNisaPrincipal,
        taxableRiskTotal: newTaxableRiskTotal,
        taxableRiskPrincipal: newTaxableRiskPrincipal,
        defenseTotal: defenseTotal + proceeds,
        defensePrincipal: defensePrincipal + proceeds,
      },
      info: {
        direction: "risk-to-defense",
        sellAmount: sellRequested,
        taxAmount: taxTaxable,
        proceeds,
        nisaUsed: 0,
      },
    };
  }

  const sell = Math.min(-delta, defenseTotal);
  const [newDefenseTotal, newDefensePrincipal] = withdrawFromBucket(
    defenseTotal,
    defensePrincipal,
    sell,
    taxRate,
  );
  // newDefenseTotal = max(defenseTotal - sell - tax, 0) なので tax = defenseTotal - newDefenseTotal - sell
  const tax = defenseTotal - newDefenseTotal - sell;
  const proceeds = sell - tax;

  const nisaCap = Math.max(0, Math.min(nisaRemainAnnual, nisaRemainLifetime));
  const toNisa = Math.min(proceeds, nisaCap);
  const toTaxable = proceeds - toNisa;

  return {
    state: {
      nisaTotal: nisaTotal + toNisa,
      nisaPrincipal: nisaPrincipal + toNisa,
      taxableRiskTotal: taxableRiskTotal + toTaxable,
      taxableRiskPrincipal: taxableRiskPrincipal + toTaxable,
      defenseTotal: newDefenseTotal,
      defensePrincipal: newDefensePrincipal,
    },
    info: {
      direction: "defense-to-risk",
      sellAmount: sell,
      taxAmount: tax,
      proceeds,
      nisaUsed: toNisa,
    },
  };
}

// 特定リスク → NISA への振替実行（年初一括）。
// 売却額のうち税引後 proceeds が targetProceeds を超えないよう sellAmount を調整する。
// targetProceeds <= 0 か特定リスク残高ゼロなら何もしない。
export function executeNisaTransfer(
  taxableRiskTotal: number,
  taxableRiskPrincipal: number,
  nisaTotal: number,
  nisaPrincipal: number,
  targetProceeds: number,
  taxRate: number,
): {
  taxableRiskTotal: number;
  taxableRiskPrincipal: number;
  nisaTotal: number;
  nisaPrincipal: number;
  info: NisaTransferInfo | null;
} {
  if (targetProceeds <= 0 || taxableRiskTotal <= 0) {
    return { taxableRiskTotal, taxableRiskPrincipal, nisaTotal, nisaPrincipal, info: null };
  }
  const gainRatio =
    taxableRiskTotal > taxableRiskPrincipal
      ? (taxableRiskTotal - taxableRiskPrincipal) / taxableRiskTotal
      : 0;
  const denom = 1 - gainRatio * taxRate;
  const sellRequested = denom > 0 ? targetProceeds / denom : targetProceeds;
  const sellAmount = Math.min(sellRequested, taxableRiskTotal);
  const [newTaxableRiskTotal, newTaxableRiskPrincipal] = withdrawFromBucket(
    taxableRiskTotal,
    taxableRiskPrincipal,
    sellAmount,
    taxRate,
  );
  const tax = taxableRiskTotal - newTaxableRiskTotal - sellAmount;
  const proceeds = sellAmount - tax;
  if (proceeds <= 0) {
    return { taxableRiskTotal, taxableRiskPrincipal, nisaTotal, nisaPrincipal, info: null };
  }
  return {
    taxableRiskTotal: newTaxableRiskTotal,
    taxableRiskPrincipal: newTaxableRiskPrincipal,
    nisaTotal: nisaTotal + proceeds,
    nisaPrincipal: nisaPrincipal + proceeds,
    info: { sellAmount, taxAmount: tax, proceeds },
  };
}

export function calculateCompound(params: CalculateParams): CompoundResult {
  const {
    initialNisa,
    initialNisaGain,
    initialTaxableRisk,
    initialTaxableRiskGain,
    initialDefense,
    initialDefenseGain,
    monthlyContribution,
    annualReturnRate,
    expenseRatio,
    inflationRate,
    contributionYears,
    withdrawalStartYear,
    withdrawalYears,
    withdrawalMode,
    fixedMonthlyWithdrawal,
    withdrawalRate,
    withdrawalLimitSchedule,
    inflationAdjustedWithdrawal,
    basePension,
    pensionStartAge,
    currentAge,
    otherIncomes,
    lifeEvents,
    defenseAnnualReturnRate,
    targetDefenseRatioStart,
    targetDefenseRatioEnd,
    glidePathEndAge,
    rebalanceThresholdPoint,
    defensePriorityOnDrawdown,
    isCoupled,
    nisaTransferEnabled,
    nisaInitialLifetimeUsed,
    idecoEnabled,
    ideco,
    guardrailUpperPercent,
    guardrailLowerPercent,
    guardrailAdjustmentPercent,
    zeroLandingCurve,
  } = params;

  const totalYears = Math.max(contributionYears, withdrawalStartYear + withdrawalYears);
  const ri = inflationRate / 100;
  const monthlyInflationFactor = ri > 0 ? Math.pow(1 + ri, 1 / 12) : 1;
  const taxRate = TAX_RATE;

  const nisaAnnualLimit = isCoupled ? NISA_ANNUAL_LIMIT * 2 : NISA_ANNUAL_LIMIT;
  const nisaLifetimeLimit = isCoupled ? NISA_LIFETIME_LIMIT * 2 : NISA_LIFETIME_LIMIT;

  const realAnnualRateRisk = (annualReturnRate - expenseRatio) / 100;
  const monthlyRateRisk = Math.pow(1 + realAnnualRateRisk, 1 / 12) - 1;
  const realAnnualRateDefense = (defenseAnnualReturnRate || 0) / 100;
  const monthlyRateDefense = Math.pow(1 + realAnnualRateDefense, 1 / 12) - 1;

  const monthlyPension = basePension > 0 ? adjustedMonthlyPension(basePension, pensionStartAge) : 0;
  // 公的年金等控除の合算枠を計算するため、控除前年額（gross）を保持する
  const grossAnnualPension = basePension > 0 ? grossMonthlyPension(basePension, pensionStartAge) * 12 : 0;
  const pensionStartYearOffset =
    basePension > 0 ? Math.max(0, pensionStartAge - currentAge) : null;

  let nisaTotal = initialNisa;
  let nisaPrincipal = Math.max(0, initialNisa - initialNisaGain);
  let taxableRiskTotal = initialTaxableRisk;
  let taxableRiskPrincipal = Math.max(0, initialTaxableRisk - initialTaxableRiskGain);
  let defenseTotal = initialDefense;
  let defensePrincipal = Math.max(0, initialDefense - initialDefenseGain);

  // iDeCo は独立 state machine。defenseRatio や NISA枠の計算には含めない。
  // idecoEnabled=false の場合は初期残高もゼロにして完全に無効化する。
  let idecoState = idecoEnabled
    ? initIdecoState(ideco)
    : { total: 0, principal: 0 };
  const idecoReceiveOffset = idecoReceiveStartYearOffset(ideco.idecoReceiveStartAge, currentAge);
  const idecoReceiveAge = computeIdecoReceiveAge(ideco.idecoReceiveStartAge, currentAge);

  let lifetimeNisaUsed = Math.max(0, nisaInitialLifetimeUsed);

  let currentMonthlyWithdrawal = fixedMonthlyWithdrawal;
  let rateBasedMonthlyWithdrawal = 0;
  let rateWithdrawalBasis: number | null = null;
  let zeroLandingInitialRiskSide: number | null = null;
  const isGuardrailMode = withdrawalMode === "rate-guardrail";
  const isAnyRateMode = withdrawalMode === "rate" || withdrawalMode === "rate-risk" || isGuardrailMode;
  const isZeroLanding = withdrawalMode === "zero-landing";
  const isClampActive = isAnyRateMode || isZeroLanding;
  // 決定論版は名目値計算のため、年率モードの下限/上限を毎年初に *=(1+ri) して実質購買力を一定に保つ。
  // schedule は実質値で受け取り、ローカルに名目コピーを保持して年初に名目化する。
  const nominalLimitSchedule: WithdrawalLimitStep[] = withdrawalLimitSchedule.map((s) => ({
    untilAge: s.untilAge,
    floor: s.floor,
    ceiling: s.ceiling,
  }));

  const projections: YearlyProjection[] = [
    {
      year: 0,
      age: currentAge,
      principal: Math.round(
        nisaPrincipal + taxableRiskPrincipal + defensePrincipal + idecoState.principal,
      ),
      interest: 0,
      tax: 0,
      total: Math.round(
        nisaTotal + taxableRiskTotal + defenseTotal + idecoState.total,
      ),
      yearlyWithdrawal: 0,
      yearlyPension: 0,
      yearlyOtherIncome: 0,
      nisaTotal: Math.round(nisaTotal),
      taxableRiskTotal: Math.round(taxableRiskTotal),
      defenseTotal: Math.round(defenseTotal),
      idecoTotal: Math.round(idecoState.total),
      nisaLifetimeUsed: Math.round(lifetimeNisaUsed),
      yearlyIdecoLumpSum: 0,
      yearlyIdecoPension: 0,
    },
  ];
  const monthlyArr: MonthlyProjection[] = [];

  for (let year = 1; year <= totalYears; year++) {
    const isContributing = year <= contributionYears;
    const isWithdrawing =
      year > withdrawalStartYear && year <= withdrawalStartYear + withdrawalYears;
    let yearlyWithdrawal = 0;
    let yearlyPension = 0;
    let yearlyOtherIncome = 0;
    let yearlyNisaUsed = 0;
    let yearlyIdecoLumpSum = 0;
    let yearlyIdecoPension = 0;

    if (ri > 0) {
      for (const step of nominalLimitSchedule) {
        if (step.floor !== null) step.floor *= 1 + ri;
        if (step.ceiling !== null) step.ceiling *= 1 + ri;
      }
    }

    // 年初にこの年の floor/ceiling を解決。月次ループ内では分割代入を作らずローカル変数で参照する。
    const ageThisYear = currentAge + year;
    const dr = resolveDefenseRatio(ageThisYear, currentAge, targetDefenseRatioStart, targetDefenseRatioEnd, glidePathEndAge);
    const limitsThisYear = findLimitForAge(nominalLimitSchedule, ageThisYear);
    const floorThisYear = limitsThisYear.floor;
    const ceilingThisYear = limitsThisYear.ceiling;

    // iDeCo 年金課税で公的年金等控除を合算消費するため、この年の公的年金 gross 年額を解決。
    const otherPensionAnnualForIdeco =
      pensionStartYearOffset != null && year >= pensionStartYearOffset && grossAnnualPension > 0
        ? grossAnnualPension
        : 0;

      // 月次積立の年間総額を年枠から先取りした残りを振替に充当する
    let yearStartTransferInfo: NisaTransferInfo | null = null;
    if (nisaTransferEnabled) {
      const contributionThisYear = isContributing ? monthlyContribution * 12 : 0;
      const annualForTransfer = Math.max(0, nisaAnnualLimit - contributionThisYear);
      const lifetimeRemain = Math.max(0, nisaLifetimeLimit - lifetimeNisaUsed);
      const targetProceeds = Math.min(annualForTransfer, lifetimeRemain);
      if (targetProceeds >= 1 && taxableRiskTotal > 0) { // 浮動小数誤差で枠到達後に極小正値が残るケースを除外
        const r = executeNisaTransfer(
          taxableRiskTotal,
          taxableRiskPrincipal,
          nisaTotal,
          nisaPrincipal,
          targetProceeds,
          taxRate,
        );
        taxableRiskTotal = r.taxableRiskTotal;
        taxableRiskPrincipal = r.taxableRiskPrincipal;
        nisaTotal = r.nisaTotal;
        nisaPrincipal = r.nisaPrincipal;
        if (r.info) {
          yearStartTransferInfo = r.info;
          yearlyNisaUsed += r.info.proceeds;
          lifetimeNisaUsed += r.info.proceeds;
        }
      }
    }

    for (let m = 0; m < 12; m++) {
      const prevNisa = nisaTotal;
      const prevTaxableRisk = taxableRiskTotal;
      const prevDefense = defenseTotal;
      const prevIdeco = idecoState.total;
      nisaTotal *= 1 + monthlyRateRisk;
      taxableRiskTotal *= 1 + monthlyRateRisk;
      defenseTotal *= 1 + monthlyRateDefense;
      const gainNisa = nisaTotal - prevNisa;
      const gainTaxableRisk = taxableRiskTotal - prevTaxableRisk;
      const gainRisk = gainNisa + gainTaxableRisk;
      const gainDefense = defenseTotal - prevDefense;

      // iDeCo ステップ: 運用→拠出→受取（一時金/年金）
      // 一時金は税引後を特定リスクに加算、年金は monOtherIncome に合流させて取り崩しで充当する。
      let idecoLumpSumInfo: IdecoPayoutEvent | null = null;
      let idecoPensionInfo: IdecoPayoutEvent | null = null;
      let gainIdeco = 0;
      let idecoPensionProceeds = 0;
      if (idecoEnabled) {
        const r = stepIdeco(
          idecoState,
          ideco,
          year,
          m,
          idecoReceiveOffset,
          idecoReceiveAge,
          monthlyRateRisk,
          otherPensionAnnualForIdeco,
        );
        idecoState = r.state;
        gainIdeco = r.gain;
        if (r.lumpSum) {
          idecoLumpSumInfo = r.lumpSum;
          taxableRiskTotal += r.lumpSum.proceeds;
          taxableRiskPrincipal += r.lumpSum.proceeds;
          yearlyIdecoLumpSum += r.lumpSum.proceeds;
        }
        if (r.pension) {
          idecoPensionInfo = r.pension;
          idecoPensionProceeds = r.pension.proceeds;
          yearlyIdecoPension += r.pension.proceeds;
        }
      }

      if (isContributing && monthlyContribution > 0) {
        const annualRemain = Math.max(0, nisaAnnualLimit - yearlyNisaUsed);
        const lifetimeRemain = Math.max(0, nisaLifetimeLimit - lifetimeNisaUsed);
        const toNisa = Math.min(monthlyContribution, annualRemain, lifetimeRemain);
        const toTaxable = monthlyContribution - toNisa;
        nisaTotal += toNisa;
        nisaPrincipal += toNisa;
        taxableRiskTotal += toTaxable;
        taxableRiskPrincipal += toTaxable;
        yearlyNisaUsed += toNisa;
        lifetimeNisaUsed += toNisa;
      }

      const currentTotal = nisaTotal + taxableRiskTotal + defenseTotal + idecoState.total;

      let monthlyWithdrawal = 0;
      let withdrawalFromNisa = 0;
      let withdrawalFromTaxableRisk = 0;
      let withdrawalFromDefense = 0;
      let withdrawalTaxTaxableRisk = 0;
      let withdrawalTaxDefense = 0;
      let baseWithdrawal = 0;
      let monthPension = 0;
      let monthOtherIncome = 0;
      const lifeEvt = m === 0 ? sumLifeEventsAt(lifeEvents, year) : null;
      // 決定論版は名目値で計算するため year-1 年分のインフレ係数で名目化する。
      const monthLifeEvent = lifeEvt ? lifeEvt.amount * Math.pow(1 + ri, year - 1) : 0;

      if (isWithdrawing && currentTotal > 0) {
        const riskSideForRate = nisaTotal + taxableRiskTotal + idecoState.total;
        const liquidRiskSide = nisaTotal + taxableRiskTotal;
        if (withdrawalMode === "rate") {
          if (m === 0 && year === withdrawalStartYear + 1) {
            rateBasedMonthlyWithdrawal = (currentTotal * withdrawalRate) / 100 / 12;
            rateWithdrawalBasis = Math.round(currentTotal);
          } else if (m === 0) {
            rateWithdrawalBasis = Math.round(currentTotal);
            rateBasedMonthlyWithdrawal *= 1 + ri;
          }
          baseWithdrawal = rateBasedMonthlyWithdrawal;
        } else if (withdrawalMode === "rate-risk") {
          if (m === 0) {
            rateBasedMonthlyWithdrawal = (riskSideForRate * withdrawalRate) / 100 / 12;
            rateWithdrawalBasis = Math.round(riskSideForRate);
          }
          baseWithdrawal = rateBasedMonthlyWithdrawal;
        } else if (isGuardrailMode) {
          if (m === 0) {
            if (year === withdrawalStartYear + 1) {
              rateBasedMonthlyWithdrawal = (riskSideForRate * withdrawalRate) / 100 / 12;
            } else {
              rateBasedMonthlyWithdrawal *= 1 + ri;
              if (riskSideForRate > 0) {
                const initialRateDec = withdrawalRate / 100;
                const currentAnnualRate = (rateBasedMonthlyWithdrawal * 12) / riskSideForRate;
                const upperBound = initialRateDec * (1 + guardrailUpperPercent / 100);
                const lowerBound = initialRateDec * (1 - guardrailLowerPercent / 100);
                if (currentAnnualRate > upperBound) {
                  rateBasedMonthlyWithdrawal *= 1 - guardrailAdjustmentPercent / 100;
                } else if (currentAnnualRate < lowerBound) {
                  rateBasedMonthlyWithdrawal *= 1 + guardrailAdjustmentPercent / 100;
                }
              }
            }
            rateWithdrawalBasis = Math.round(riskSideForRate);
          }
          baseWithdrawal = rateBasedMonthlyWithdrawal;
        } else if (isZeroLanding && zeroLandingCurve !== undefined) {
          const liquidRiskSideForZL = nisaTotal + taxableRiskTotal;
          if (zeroLandingInitialRiskSide === null) {
            zeroLandingInitialRiskSide = liquidRiskSideForZL > 0 ? liquidRiskSideForZL : 1;
          }
          const ratio = liquidRiskSideForZL / zeroLandingInitialRiskSide;
          if (ageThisYear >= zeroLandingCurve.noGoStartAge) {
            baseWithdrawal = zeroLandingCurve.noGoMonthly * Math.pow(1 + ri, year);
          } else if (ageThisYear >= zeroLandingCurve.slowGoStartAge) {
            baseWithdrawal = fixedMonthlyWithdrawal * zeroLandingCurve.slowGoCoef * ratio * Math.pow(1 + ri, year);
          } else {
            baseWithdrawal = fixedMonthlyWithdrawal * ratio * Math.pow(1 + ri, year);
          }
        } else {
          baseWithdrawal = currentMonthlyWithdrawal;
          if (inflationAdjustedWithdrawal) {
            currentMonthlyWithdrawal *= monthlyInflationFactor;
          }
        }

        if (isClampActive) {
          baseWithdrawal = clampToBounds(baseWithdrawal, floorThisYear, ceilingThisYear);
        }

        const pensionActive =
          pensionStartYearOffset != null && year >= pensionStartYearOffset && monthlyPension > 0;
        monthPension = pensionActive ? monthlyPension : 0;
        // iDeCo の年金受取分は otherIncome と同様に支出充当する。
        monthOtherIncome = sumOtherIncomeAt(otherIncomes, year) + idecoPensionProceeds;
        const income = monthPension + monthOtherIncome;
        const grossOutflow = baseWithdrawal + monthLifeEvent;
        const netWithdrawal = Math.max(grossOutflow - income, 0);

        const [fromRiskSide, fromDefense] = defensePriorityOnDrawdown
          ? splitRiskFirst(netWithdrawal, liquidRiskSide, defenseTotal)
          : splitProportional(netWithdrawal, liquidRiskSide, defenseTotal);
        const [fromTaxableRisk, fromNisa] = splitRiskSide(
          fromRiskSide,
          taxableRiskTotal,
          nisaTotal,
        );
        const prevTaxableRiskTotalForTax = taxableRiskTotal;
        const prevDefenseTotalForTax = defenseTotal;
        [taxableRiskTotal, taxableRiskPrincipal] = withdrawFromBucket(
          taxableRiskTotal,
          taxableRiskPrincipal,
          fromTaxableRisk,
          taxRate,
        );
        [nisaTotal, nisaPrincipal] = withdrawFromBucket(
          nisaTotal,
          nisaPrincipal,
          fromNisa,
          0,
        );
        [defenseTotal, defensePrincipal] = withdrawFromBucket(
          defenseTotal,
          defensePrincipal,
          fromDefense,
          taxRate,
        );

        // withdrawFromBucket: newTotal = total - amount - tax → tax = prevTotal - newTotal - amount
        withdrawalTaxTaxableRisk = prevTaxableRiskTotalForTax - taxableRiskTotal - fromTaxableRisk;
        withdrawalTaxDefense = prevDefenseTotalForTax - defenseTotal - fromDefense;
        withdrawalFromTaxableRisk = fromTaxableRisk;
        withdrawalFromNisa = fromNisa;
        withdrawalFromDefense = fromDefense;
        monthlyWithdrawal = fromTaxableRisk + fromNisa + fromDefense;
        yearlyWithdrawal += monthlyWithdrawal;
        yearlyPension += monthPension;
        yearlyOtherIncome += monthOtherIncome;
      }

      let rebalanceInfo: RebalanceInfo | null = null;
      if (dr > 0) {
        const riskSideForRebalance = nisaTotal + taxableRiskTotal + idecoState.total;
        if (needsRebalance(riskSideForRebalance, defenseTotal, dr, rebalanceThresholdPoint)) {
          const annualRemain = Math.max(0, nisaAnnualLimit - yearlyNisaUsed);
          const lifetimeRemain = Math.max(0, nisaLifetimeLimit - lifetimeNisaUsed);
          const rb = rebalanceTriBuckets(
            {
              nisaTotal,
              nisaPrincipal,
              taxableRiskTotal,
              taxableRiskPrincipal,
              defenseTotal,
              defensePrincipal,
            },
            dr,
            taxRate,
            annualRemain,
            lifetimeRemain,
            idecoState.total,
          );
          nisaTotal = rb.state.nisaTotal;
          nisaPrincipal = rb.state.nisaPrincipal;
          taxableRiskTotal = rb.state.taxableRiskTotal;
          taxableRiskPrincipal = rb.state.taxableRiskPrincipal;
          defenseTotal = rb.state.defenseTotal;
          defensePrincipal = rb.state.defensePrincipal;
          rebalanceInfo = rb.info;
          if (rb.info && rb.info.nisaUsed > 0) {
            yearlyNisaUsed += rb.info.nisaUsed;
            lifetimeNisaUsed += rb.info.nisaUsed;
          }
        }
      }

      const prevRiskSide = prevNisa + prevTaxableRisk + prevIdeco;
      const prevTotal = prevRiskSide + prevDefense;
      const gainRiskAll = gainRisk + gainIdeco;
      const gainTotal = gainRiskAll + gainDefense;
      const monthlyRate = prevTotal > 0 ? gainTotal / prevTotal : 0;
      const monthlyRateRiskSide = prevRiskSide > 0 ? gainRiskAll / prevRiskSide : 0;
      monthlyArr.push({
        year,
        month: m + 1,
        age: currentAge + year,
        nisaTotal: Math.round(nisaTotal),
        taxableRiskTotal: Math.round(taxableRiskTotal),
        riskTotal: Math.round(nisaTotal + taxableRiskTotal + idecoState.total),
        defenseTotal: Math.round(defenseTotal),
        idecoTotal: Math.round(idecoState.total),
        total: Math.round(nisaTotal + taxableRiskTotal + defenseTotal + idecoState.total),
        monthlyWithdrawal: Math.round(monthlyWithdrawal),
        monthlyWithdrawalNisa: Math.round(withdrawalFromNisa),
        monthlyWithdrawalTaxableRisk: Math.round(withdrawalFromTaxableRisk),
        monthlyWithdrawalDefense: Math.round(withdrawalFromDefense),
        monthlyWithdrawalTaxTaxableRisk: Math.round(withdrawalTaxTaxableRisk),
        monthlyWithdrawalTaxDefense: Math.round(withdrawalTaxDefense),
        baseWithdrawal: Math.round(baseWithdrawal),
        rateWithdrawalBasis,
        monthlyPension: Math.round(monthPension),
        monthlyOtherIncome: Math.round(monthOtherIncome),
        monthlyGainRisk: Math.round(gainRisk),
        monthlyGainNisa: Math.round(gainNisa),
        monthlyGainTaxableRisk: Math.round(gainTaxableRisk),
        monthlyGainDefense: Math.round(gainDefense),
        monthlyGainIdeco: Math.round(gainIdeco),
        monthlyGain: Math.round(gainTotal),
        monthlyRate,
        monthlyRateRisk: monthlyRateRiskSide,
        rebalanceInfo,
        nisaTransferInfo: m === 0 ? yearStartTransferInfo : null,
        idecoLumpSumInfo,
        idecoPensionInfo,
        ...(lifeEvt && monthLifeEvent > 0
          ? { lifeEventInfo: { amount: monthLifeEvent, label: lifeEvt.label } }
          : {}),
      });
    }

    // tax: 年末時点でまだ売却していない含み益に対する「もし全部売却したら」の試算税。NISA・iDeCo分は除外。
    // 月次ループ中に取り崩しと共に発生した課税分は currentTotal から既に控除済み。
    const endTaxable = taxableRiskTotal + defenseTotal;
    const endTaxablePrincipal = taxableRiskPrincipal + defensePrincipal;
    const endNisa = nisaTotal;
    const endNisaPrincipal = nisaPrincipal;
    const endIdeco = idecoState.total;
    const endIdecoPrincipal = idecoState.principal;
    const endTotal = endTaxable + endNisa + endIdeco;
    const endPrincipal = endTaxablePrincipal + endNisaPrincipal + endIdecoPrincipal;
    const taxableGain = endTaxable - endTaxablePrincipal;
    const nisaGain = endNisa - endNisaPrincipal;
    const idecoGain = endIdeco - endIdecoPrincipal;
    const tax = taxableGain > 0 ? Math.round(taxableGain * taxRate) : 0;
    const totalInterest =
      (taxableGain > 0 ? taxableGain : 0) +
      (nisaGain > 0 ? nisaGain : 0) +
      (idecoGain > 0 ? idecoGain : 0);
    const afterTaxTotal = Math.max(endTotal - tax, 0);
    projections.push({
      year,
      age: currentAge + year,
      principal: Math.round(endPrincipal),
      interest: totalInterest > 0 ? Math.round(totalInterest - tax) : 0,
      tax,
      total: Math.round(afterTaxTotal),
      yearlyWithdrawal: Math.round(yearlyWithdrawal),
      yearlyPension: Math.round(yearlyPension),
      yearlyOtherIncome: Math.round(yearlyOtherIncome),
      nisaTotal: Math.round(nisaTotal),
      taxableRiskTotal: Math.round(taxableRiskTotal),
      defenseTotal: Math.round(defenseTotal),
      idecoTotal: Math.round(idecoState.total),
      nisaLifetimeUsed: Math.round(lifetimeNisaUsed),
      yearlyIdecoLumpSum: Math.round(yearlyIdecoLumpSum),
      yearlyIdecoPension: Math.round(yearlyIdecoPension),
    });
  }

  return { yearly: projections, monthly: monthlyArr };
}
