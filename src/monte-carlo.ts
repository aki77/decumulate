// モンテカルロ・シミュレーション（GBM、5000パス）
// 実質値（インフレ控除後）で計算。再現性のため Mulberry32 + Box-Muller を使用。
// 口座構造: NISA(非課税) / 特定リスク(課税) / 防衛(課税) の3バケット + iDeCo（独立）
import { adjustedMonthlyPension, grossMonthlyPension } from "./pension.ts";
import {
  TAX_RATE,
  NISA_ANNUAL_LIMIT,
  NISA_LIFETIME_LIMIT,
  executeNisaTransfer,
  findLimitForAge,
  needsRebalance,
  type CalculateParams,
  type MonthlyProjection,
  type NisaTransferInfo,
  type RebalanceInfo,
} from "./calculate.ts";
import { sumOtherIncomeAt } from "./other-income.ts";
import {
  idecoEffectiveTaxRateForMC,
  idecoReceiveAge as computeIdecoReceiveAge,
  idecoReceiveStartYearOffset,
  type IdecoPayoutEvent,
} from "./ideco.ts";

const NUM_SIMULATIONS = 5000;
const SEED = 42;

export interface MonteCarloParams extends CalculateParams {
  volatility: number;
  defenseVolatility: number;
  drawdownThresholdPercent: number;
  skipRebalanceOnDrawdown: boolean;
}

export interface MonteCarloYearly {
  year: number;
  age: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  depletionRate: number;
  medianYearlyWithdrawal: number;
}

export type PercentileKey = "p10" | "p25" | "p50" | "p75" | "p90";
export const PERCENTILE_KEYS: readonly PercentileKey[] = ["p10", "p25", "p50", "p75", "p90"];
export type PivotMonthlies = Record<PercentileKey, MonthlyProjection[]>;

export interface MonteCarloResult {
  yearly: MonteCarloYearly[];
  failureProbability: number;
  depletionProbability: number;
  finalP50: number;
  finalP10: number;
  finalP90: number;
  pivotMonthlies: PivotMonthlies;
}

export interface SecurityScoreInput {
  depletionProbability: number;
  failureProbability: number;
  medianFinal: number;
}

export type ScoreClassName =
  | "score-excellent"
  | "score-safe"
  | "score-caution"
  | "score-warn"
  | "score-danger";

export interface ScoreLabelResult {
  label: string;
  className: ScoreClassName;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateMonteCarlo(params: MonteCarloParams): MonteCarloResult {
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
    volatility,
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
    defenseAnnualReturnRate,
    defenseVolatility,
    targetDefenseRatio,
    defensePriorityOnDrawdown,
    drawdownThresholdPercent,
    rebalanceThresholdPoint,
    skipRebalanceOnDrawdown,
    isCoupled,
    nisaTransferEnabled,
    nisaInitialLifetimeUsed,
    idecoEnabled,
    ideco,
  } = params;

  const totalYears = Math.max(contributionYears, withdrawalStartYear + withdrawalYears);
  const ri = inflationRate / 100;
  const taxRate = TAX_RATE;

  const dr = Math.max(0, Math.min(1, targetDefenseRatio / 100));
  const useDefense = dr > 0;
  const initialTotal = initialNisa + initialTaxableRisk + initialDefense;

  const nisaAnnualLimit = isCoupled ? NISA_ANNUAL_LIMIT * 2 : NISA_ANNUAL_LIMIT;
  const nisaLifetimeLimit = isCoupled ? NISA_LIFETIME_LIMIT * 2 : NISA_LIFETIME_LIMIT;

  const muRisk = (annualReturnRate - expenseRatio) / 100;
  const sigmaRisk = volatility / 100;
  const monthlyDriftRisk = (muRisk - ri - (sigmaRisk * sigmaRisk) / 2) / 12;
  const monthlySigmaRisk = sigmaRisk / Math.sqrt(12);

  const muDef = (defenseAnnualReturnRate || 0) / 100;
  const sigmaDef = (defenseVolatility || 0) / 100;
  const monthlyDriftDef = (muDef - ri - (sigmaDef * sigmaDef) / 2) / 12;
  const monthlySigmaDef = sigmaDef / Math.sqrt(12);

  const drawdownThreshold = Math.max(0, drawdownThresholdPercent || 0) / 100;
  const priorityOnDrawdown = !!defensePriorityOnDrawdown && useDefense;
  const skipRebalanceWhenDrawdown = !!skipRebalanceOnDrawdown;

  const monthlyPension = basePension > 0 ? adjustedMonthlyPension(basePension, pensionStartAge) : 0;
  // iDeCo 年金分の課税で公的年金等控除を合算消費するため、控除前年額（gross）を保持する
  const grossAnnualPension = basePension > 0 ? grossMonthlyPension(basePension, pensionStartAge) * 12 : 0;
  const pensionStartYearOffset =
    basePension > 0 ? Math.max(0, pensionStartAge - currentAge) : null;

  const isRateMode = withdrawalMode === "rate";
  const isRateRiskMode = withdrawalMode === "rate-risk";
  const isAnyRateMode = isRateMode || isRateRiskMode;

  // MC は内部が実質値計算。入力値（今日の購買力）をそのまま全期間の実質閾値に使う（決定論版とは違いインフレ進行させない）。
  // ホットループ内の分岐を避けるため、年インデックス → floor/ceiling の Float64Array を事前展開する。
  // null は ±Infinity にエンコードして clampToBounds の条件式（v < -Infinity / v > +Infinity）を常に false 評価にする。
  const floorByYear = new Float64Array(totalYears + 1);
  const ceilingByYear = new Float64Array(totalYears + 1);
  for (let y = 0; y <= totalYears; y++) {
    const ageThisYear = currentAge + y;
    const { floor, ceiling } = findLimitForAge(withdrawalLimitSchedule, ageThisYear);
    floorByYear[y] = floor !== null ? floor : Number.NEGATIVE_INFINITY;
    ceilingByYear[y] = ceiling !== null ? ceiling : Number.POSITIVE_INFINITY;
  }

  // 名目固定の引出額は実質値で目減りするのでデフレ調整
  const preWithdrawalDeflation =
    !isAnyRateMode && !inflationAdjustedWithdrawal && ri > 0
      ? Math.pow(1 + ri, -withdrawalStartYear)
      : 1;
  const monthlyRealWithdrawalFactor =
    !isAnyRateMode && !inflationAdjustedWithdrawal && ri > 0
      ? 1 / Math.pow(1 + ri, 1 / 12)
      : 1;

  const N = NUM_SIMULATIONS;
  const initialNisaPrincipalValue = Math.max(0, initialNisa - initialNisaGain);
  const initialTaxableRiskPrincipalValue = Math.max(0, initialTaxableRisk - initialTaxableRiskGain);
  const initialDefensePrincipalValue = Math.max(0, initialDefense - initialDefenseGain);

  // iDeCo の事前計算（MC は簡易税率を一括適用）。
  const initialIdecoValue = idecoEnabled ? Math.max(0, ideco.initialIdeco) : 0;
  const initialRiskSide = initialNisa + initialTaxableRisk + initialIdecoValue;
  const initialIdecoPrincipalValue = idecoEnabled
    ? Math.max(0, initialIdecoValue - Math.max(0, ideco.initialIdecoGain))
    : 0;
  const idecoReceiveOffset = idecoEnabled
    ? idecoReceiveStartYearOffset(ideco.idecoReceiveStartAge, currentAge)
    : 0;
  const idecoReceiveAge = idecoEnabled
    ? computeIdecoReceiveAge(ideco.idecoReceiveStartAge, currentAge)
    : 65;
  // 公的年金等控除は合算枠（iDeCo 年金 + 公的年金）で消費するため、grossAnnualPension を渡す。
  // 厳密には iDeCo 年金受給期間中に公的年金が始まる/まだ始まっていない月があるが、MC は一律レート前提なのでフル消費として扱う。
  const idecoEffective = idecoEnabled
    ? idecoEffectiveTaxRateForMC(ideco, idecoReceiveAge, grossAnnualPension)
    : { lumpSumRate: 0, pensionAnnualGrossEstimate: 0, pensionRate: 0 };
  const idecoPensionTotalMonths = idecoEnabled ? Math.max(0, ideco.idecoPensionYears) * 12 : 0;
  const idecoLumpRatio = idecoEnabled
    ? Math.max(0, Math.min(1, ideco.idecoLumpSumRatio))
    : 0;

  // 本体ループを内部関数化している理由: pivotMask=null（フェーズ1）と pivotMask=非null（フェーズ2）の
  // 間で RNG 消費順序を完全に揃えることで、両フェーズが同じパスを生成し再現性を保つ。
  const runSimulation = (
    pivotIndices: Record<PercentileKey, number> | null,
  ): {
    yearly: MonteCarloYearly[];
    failureProbability: number;
    finalTotals: Float64Array | null;
    pivotMonthlies: PivotMonthlies;
  } => {
  // ホットループ（N×12×totalYears 回）で O(1) かつ分岐予測しやすい判定にするため、
  // パス index → 該当パーセンタイル の対応を Uint8Array のビットマスクで保持する。
  // 同一 index が複数パーセンタイルに最近接になる稀なケースもビット OR で表現できる。
  const pivotMaskByIndex = pivotIndices ? new Uint8Array(N) : null;
  if (pivotIndices && pivotMaskByIndex) {
    for (let bit = 0; bit < PERCENTILE_KEYS.length; bit++) {
      const k = PERCENTILE_KEYS[bit]!;
      pivotMaskByIndex[pivotIndices[k]]! |= 1 << bit;
    }
  }
  const keysForMask = (mask: number): PercentileKey[] => {
    const out: PercentileKey[] = [];
    for (let bit = 0; bit < PERCENTILE_KEYS.length; bit++) {
      if (mask & (1 << bit)) out.push(PERCENTILE_KEYS[bit]!);
    }
    return out;
  };
  const rng = mulberry32(SEED);
  const nisaPaths = new Float64Array(N).fill(initialNisa);
  const nisaCostBasis = new Float64Array(N).fill(initialNisaPrincipalValue);
  const taxablePaths = new Float64Array(N).fill(initialTaxableRisk);
  const taxableCostBasis = new Float64Array(N).fill(initialTaxableRiskPrincipalValue);
  const defensePaths = useDefense ? new Float64Array(N).fill(initialDefense) : null;
  const defenseCostBasis = useDefense ? new Float64Array(N).fill(initialDefensePrincipalValue) : null;
  // iDeCo: リスクと同じ zRisk で運用するため Float64Array 1本のみ。受取は税引後額を返す。
  const idecoPaths = idecoEnabled ? new Float64Array(N).fill(initialIdecoValue) : null;
  const useIdeco = idecoEnabled && idecoPaths !== null;
  // 下落判定は「リスクサイド合計」のHWMで判断する
  const riskSideHWM = priorityOnDrawdown ? new Float64Array(N).fill(initialRiskSide) : null;
  const cumulativeWithdrawals = new Float64Array(N);
  const rateBasedMonthlyWithdrawal = new Float64Array(N);
  const rateWithdrawalInitialized = new Uint8Array(N);
  const currentMonthlyWithdrawal = new Float64Array(N).fill(
    fixedMonthlyWithdrawal * preWithdrawalDeflation,
  );
  const lifetimeNisaUsed = new Float64Array(N).fill(Math.max(0, nisaInitialLifetimeUsed));
  const yearlyNisaUsed = new Float64Array(N);
  const nisaTransferByIndex = new Map<number, NisaTransferInfo>();
  const totalPaths = new Float64Array(N);
  const pivotMonthlies: PivotMonthlies = {
    p10: [],
    p25: [],
    p50: [],
    p75: [],
    p90: [],
  };

  const pushPivotRow = (
    keys: readonly PercentileKey[],
    raw: {
      year: number;
      month: number;
      prevNisa: number;
      prevTaxable: number;
      prevDefense: number;
      prevIdeco: number;
      nisaTotal: number;
      taxableRiskTotal: number;
      defenseTotal: number;
      idecoTotal: number;
      monthlyWithdrawal: number;
      monthlyWithdrawalNisa: number;
      monthlyWithdrawalTaxableRisk: number;
      monthlyWithdrawalDefense: number;
      monthlyWithdrawalTaxTaxableRisk: number;
      monthlyWithdrawalTaxDefense: number;
      monthlyPension: number;
      monthlyOtherIncome: number;
      monthlyGainRisk: number;
      monthlyGainNisa: number;
      monthlyGainTaxableRisk: number;
      monthlyGainDefense: number;
      monthlyGainIdeco: number;
      rebalanceInfo: RebalanceInfo | null;
      nisaTransferInfo: NisaTransferInfo | null;
      idecoLumpSumInfo: IdecoPayoutEvent | null;
      idecoPensionInfo: IdecoPayoutEvent | null;
    },
  ): void => {
    const prevTotal = raw.prevNisa + raw.prevTaxable + raw.prevDefense + raw.prevIdeco;
    const monthlyRate =
      prevTotal > 0
        ? (raw.monthlyGainRisk + raw.monthlyGainDefense + raw.monthlyGainIdeco) / prevTotal
        : 0;
    const row: MonthlyProjection = {
      year: raw.year,
      month: raw.month,
      age: currentAge + raw.year,
      nisaTotal: Math.round(raw.nisaTotal),
      taxableRiskTotal: Math.round(raw.taxableRiskTotal),
      riskTotal: Math.round(raw.nisaTotal + raw.taxableRiskTotal + raw.idecoTotal),
      defenseTotal: Math.round(raw.defenseTotal),
      idecoTotal: Math.round(raw.idecoTotal),
      total: Math.round(
        raw.nisaTotal + raw.taxableRiskTotal + raw.defenseTotal + raw.idecoTotal,
      ),
      monthlyWithdrawal: Math.round(raw.monthlyWithdrawal),
      monthlyWithdrawalNisa: Math.round(raw.monthlyWithdrawalNisa),
      monthlyWithdrawalTaxableRisk: Math.round(raw.monthlyWithdrawalTaxableRisk),
      monthlyWithdrawalDefense: Math.round(raw.monthlyWithdrawalDefense),
      monthlyWithdrawalTaxTaxableRisk: Math.round(raw.monthlyWithdrawalTaxTaxableRisk),
      monthlyWithdrawalTaxDefense: Math.round(raw.monthlyWithdrawalTaxDefense),
      baseWithdrawal: Math.round(raw.monthlyWithdrawal),
      rateWithdrawalBasis:
        raw.month === 1 && (isRateMode || isRateRiskMode)
          ? isRateRiskMode
            ? Math.round(raw.prevNisa + raw.prevTaxable + raw.prevIdeco)
            : Math.round(raw.prevNisa + raw.prevTaxable + raw.prevDefense + raw.prevIdeco)
          : null,
      monthlyPension: Math.round(raw.monthlyPension),
      monthlyOtherIncome: Math.round(raw.monthlyOtherIncome),
      monthlyGainRisk: Math.round(raw.monthlyGainRisk),
      monthlyGainNisa: Math.round(raw.monthlyGainNisa),
      monthlyGainTaxableRisk: Math.round(raw.monthlyGainTaxableRisk),
      monthlyGainDefense: Math.round(raw.monthlyGainDefense),
      monthlyGainIdeco: Math.round(raw.monthlyGainIdeco),
      monthlyGain: Math.round(
        raw.monthlyGainRisk + raw.monthlyGainDefense + raw.monthlyGainIdeco,
      ),
      monthlyRate,
      rebalanceInfo: raw.rebalanceInfo,
      nisaTransferInfo: raw.nisaTransferInfo,
      idecoLumpSumInfo: raw.idecoLumpSumInfo,
      idecoPensionInfo: raw.idecoPensionInfo,
    };
    for (const k of keys) pivotMonthlies[k].push(row);
  };

  const yearly: MonteCarloYearly[] = [
    {
      year: 0,
      age: currentAge,
      p10: initialTotal,
      p25: initialTotal,
      p50: initialTotal,
      p75: initialTotal,
      p90: initialTotal,
      depletionRate: 0,
      medianYearlyWithdrawal: 0,
    },
  ];

  // RNG は触らない pure pre-compute なので phase1/phase2 のパス一致性に影響しない。
  const otherIncomePerYear = new Float64Array(totalYears + 1);
  for (let y = 1; y <= totalYears; y++) {
    otherIncomePerYear[y] = sumOtherIncomeAt(otherIncomes, y - 1);
  }

  for (let year = 1; year <= totalYears; year++) {
    const isContributing = year <= contributionYears;
    const isWithdrawing =
      year > withdrawalStartYear && year <= withdrawalStartYear + withdrawalYears;
    const isFirstWithdrawalYear = year === withdrawalStartYear + 1;
    const checkDrawdown = priorityOnDrawdown && (isWithdrawing || skipRebalanceWhenDrawdown);
    const pensionActive =
      pensionStartYearOffset != null && year >= pensionStartYearOffset && monthlyPension > 0;
    const monthPension = pensionActive ? monthlyPension : 0;
    const monthOtherIncomeForYear = otherIncomePerYear[year]!;
    const yearlyWithdrawals = new Float64Array(N);

    yearlyNisaUsed.fill(0);
    nisaTransferByIndex.clear();

    // 年初一括NISA振替（各パスで実行）。N×Y 回 = ホットループ外なので executeNisaTransfer を再利用。
    if (nisaTransferEnabled) {
      const contributionThisYear = isContributing ? monthlyContribution * 12 : 0;
      const annualForTransfer = Math.max(0, nisaAnnualLimit - contributionThisYear);
      for (let i = 0; i < N; i++) {
        const lifetimeRemain = Math.max(0, nisaLifetimeLimit - lifetimeNisaUsed[i]!);
        const targetProceeds = Math.min(annualForTransfer, lifetimeRemain);
        if (targetProceeds < 1 || taxablePaths[i]! <= 0) continue; // 浮動小数誤差で枠到達後に極小正値が残るケースを除外
        const r = executeNisaTransfer(
          taxablePaths[i]!,
          taxableCostBasis[i]!,
          nisaPaths[i]!,
          nisaCostBasis[i]!,
          targetProceeds,
          taxRate,
        );
        taxablePaths[i] = r.taxableRiskTotal;
        taxableCostBasis[i] = r.taxableRiskPrincipal;
        nisaPaths[i] = r.nisaTotal;
        nisaCostBasis[i] = r.nisaPrincipal;
        if (r.info) {
          yearlyNisaUsed[i]! += r.info.proceeds;
          lifetimeNisaUsed[i]! += r.info.proceeds;
          if (pivotMaskByIndex !== null && pivotMaskByIndex[i]! !== 0) {
            nisaTransferByIndex.set(i, r.info);
          }
        }
      }
    }

    // rate モードでは年頭にインフレ調整。決定論と挙動を揃える。
    if (isWithdrawing && isRateMode) {
      for (let i = 0; i < N; i++) {
        if (rateWithdrawalInitialized[i] && ri > 0) {
          rateBasedMonthlyWithdrawal[i]! *= 1 + ri;
        }
      }
    }

    for (let m = 0; m < 12; m++) {
      const isWithdrawalStartMonth = isFirstWithdrawalYear && m === 0;

      // i に依存しない iDeCo フェーズ判定を m ループ先頭で先計算する
      const idecoContributing =
        useIdeco &&
        ideco.idecoMonthlyContribution > 0 &&
        year <= ideco.idecoContributionYears &&
        year <= idecoReceiveOffset;
      const idecoIsLumpSumMonth =
        useIdeco && year === idecoReceiveOffset + 1 && m === 0 && idecoLumpRatio > 0;
      const idecoMonthIndex = (year - 1 - idecoReceiveOffset) * 12 + m;
      const idecoIsPensionMonth =
        useIdeco &&
        idecoLumpRatio < 1 &&
        idecoPensionTotalMonths > 0 &&
        idecoMonthIndex >= 0 &&
        idecoMonthIndex < idecoPensionTotalMonths;
      const idecoPensionRemainMonths = idecoPensionTotalMonths - idecoMonthIndex;

      for (let i = 0; i < N; i++) {
        const pivotMask = pivotMaskByIndex !== null ? pivotMaskByIndex[i]! : 0;
        const recordPivot = pivotMask !== 0;
        const prevNisa = nisaPaths[i]!;
        const prevTaxable = taxablePaths[i]!;
        const prevDefense = useDefense && defensePaths !== null ? defensePaths[i]! : 0;
        const prevIdeco = useIdeco ? idecoPaths![i]! : 0;

        const zRisk = normalRandom(rng);
        const riskGrow = Math.exp(monthlyDriftRisk + monthlySigmaRisk * zRisk);
        nisaPaths[i]! *= riskGrow;
        taxablePaths[i]! *= riskGrow;
        let gainDefense = 0;
        if (useDefense && defensePaths !== null) {
          const zDef = normalRandom(rng);
          defensePaths[i]! *= Math.exp(monthlyDriftDef + monthlySigmaDef * zDef);
          gainDefense = defensePaths[i]! - prevDefense;
        }
        // iDeCo: リスクと同じ zRisk で運用（仕様: 同利回り）。RNG 消費は増えないので既存テスト維持。
        let gainIdeco = 0;
        if (useIdeco) {
          idecoPaths![i]! *= riskGrow;
          gainIdeco = idecoPaths![i]! - prevIdeco;
        }

        const gainNisa = nisaPaths[i]! - prevNisa;
        const gainTaxable = taxablePaths[i]! - prevTaxable;
        const gainRisk = gainNisa + gainTaxable;
        let monthlyWithdrawalRecorded = 0;
        let withdrawalFromNisaRecorded = 0;
        let withdrawalFromTaxableRecorded = 0;
        let withdrawalFromDefenseRecorded = 0;
        let withdrawalTaxTaxableRecorded = 0;
        let withdrawalTaxDefenseRecorded = 0;
        let pensionRecorded = 0;
        let otherIncomeRecorded = 0;
        let rebalanceInfoRecorded: RebalanceInfo | null = null;
        let idecoLumpSumRecorded: IdecoPayoutEvent | null = null;
        let idecoPensionRecorded: IdecoPayoutEvent | null = null;
        let idecoPensionProceedsForMonth = 0;

        if (idecoContributing) {
          idecoPaths![i]! += ideco.idecoMonthlyContribution;
        }

        if (idecoIsLumpSumMonth && idecoPaths![i]! > 0) {
          const gross = idecoPaths![i]! * idecoLumpRatio;
          const tax = gross * idecoEffective.lumpSumRate;
          const proceeds = Math.max(0, gross - tax);
          idecoPaths![i]! = Math.max(0, idecoPaths![i]! - gross);
          taxablePaths[i]! += proceeds;
          taxableCostBasis[i]! += proceeds;
          if (recordPivot) {
            idecoLumpSumRecorded = { grossAmount: gross, taxAmount: tax, proceeds };
          }
        }

        if (idecoIsPensionMonth && idecoPaths![i]! > 0) {
          const gross =
            idecoPensionRemainMonths > 0 ? idecoPaths![i]! / idecoPensionRemainMonths : idecoPaths![i]!;
          const monthlyTax = gross * idecoEffective.pensionRate;
          const proceeds = Math.max(0, gross - monthlyTax);
          idecoPaths![i]! = Math.max(0, idecoPaths![i]! - gross);
          idecoPensionProceedsForMonth = proceeds;
          if (recordPivot) {
            idecoPensionRecorded = { grossAmount: gross, taxAmount: monthlyTax, proceeds };
          }
        }

        if (isContributing && monthlyContribution > 0) {
          const annualRemain = Math.max(0, nisaAnnualLimit - yearlyNisaUsed[i]!);
          const lifetimeRemain = Math.max(0, nisaLifetimeLimit - lifetimeNisaUsed[i]!);
          const toNisa = Math.min(monthlyContribution, annualRemain, lifetimeRemain);
          const toTaxable = monthlyContribution - toNisa;
          nisaPaths[i]! += toNisa;
          nisaCostBasis[i]! += toNisa;
          taxablePaths[i]! += toTaxable;
          taxableCostBasis[i]! += toTaxable;
          yearlyNisaUsed[i]! += toNisa;
          lifetimeNisaUsed[i]! += toNisa;
        }

        const idecoValue = useIdeco ? idecoPaths![i]! : 0;
        const liquidRiskSide = nisaPaths[i]! + taxablePaths[i]!;
        const riskSide = liquidRiskSide + idecoValue;
        const defenseValue = useDefense && defensePaths !== null ? defensePaths[i]! : 0;

        // 積立期のピーク値を引きずらないよう、取り崩し開始月に高値基準（HWM）を再初期化する
        if (priorityOnDrawdown && riskSideHWM !== null) {
          if (isWithdrawalStartMonth) {
            riskSideHWM[i] = riskSide;
          } else if (isWithdrawing && riskSide > riskSideHWM[i]!) {
            riskSideHWM[i] = riskSide;
          }
        }

        const total = riskSide + defenseValue;
        const inDrawdown =
          checkDrawdown &&
          riskSideHWM !== null &&
          riskSideHWM[i]! > 0 &&
          1 - riskSide / riskSideHWM[i]! >= drawdownThreshold;

        if (isWithdrawing && total > 0) {
          let baseWithdrawal: number;
          if (isRateMode) {
            if (!rateWithdrawalInitialized[i]) {
              rateBasedMonthlyWithdrawal[i] = (total * withdrawalRate) / 100 / 12;
              rateWithdrawalInitialized[i] = 1;
            }
            baseWithdrawal = rateBasedMonthlyWithdrawal[i]!;
          } else if (isRateRiskMode) {
            if (m === 0) {
              rateBasedMonthlyWithdrawal[i] = (riskSide * withdrawalRate) / 100 / 12;
            }
            baseWithdrawal = rateBasedMonthlyWithdrawal[i]!;
          } else {
            baseWithdrawal = currentMonthlyWithdrawal[i]!;
          }

          if (isAnyRateMode) {
            const floorThisYear = floorByYear[year]!;
            const ceilingThisYear = ceilingByYear[year]!;
            if (baseWithdrawal < floorThisYear) baseWithdrawal = floorThisYear;
            if (baseWithdrawal > ceilingThisYear) baseWithdrawal = ceilingThisYear;
          }

          const monOtherIncomeWithIdeco = monthOtherIncomeForYear + idecoPensionProceedsForMonth;
          const income = monthPension + monOtherIncomeWithIdeco;
          const netWithdrawal = Math.max(baseWithdrawal - income, 0);

          if (recordPivot) {
            pensionRecorded = monthPension;
            otherIncomeRecorded = monOtherIncomeWithIdeco;
          }

          if (netWithdrawal > 0) {
            let fromRiskSide: number;
            let fromDefense: number;
            if (useDefense && defensePaths !== null) {
              if (inDrawdown && defenseValue > 0) {
                fromDefense = Math.min(netWithdrawal, defenseValue);
                fromRiskSide = netWithdrawal - fromDefense;
              } else if (priorityOnDrawdown && liquidRiskSide > 0) {
                fromRiskSide = Math.min(netWithdrawal, liquidRiskSide);
                fromDefense = netWithdrawal - fromRiskSide;
              } else {
                fromRiskSide = netWithdrawal * (liquidRiskSide / total);
                fromDefense = netWithdrawal * (defenseValue / total);
              }
              if (fromRiskSide > liquidRiskSide) {
                fromDefense += fromRiskSide - liquidRiskSide;
                fromRiskSide = liquidRiskSide;
              }
              if (fromDefense > defenseValue) {
                fromRiskSide += fromDefense - defenseValue;
                fromDefense = defenseValue;
              }
              if (fromRiskSide > liquidRiskSide) fromRiskSide = liquidRiskSide;
              if (fromDefense > defenseValue) fromDefense = defenseValue;
            } else {
              fromRiskSide = Math.min(netWithdrawal, liquidRiskSide);
              fromDefense = 0;
            }

            const fromTaxable = Math.min(fromRiskSide, Math.max(taxablePaths[i]!, 0));
            const fromNisa = Math.min(fromRiskSide - fromTaxable, Math.max(nisaPaths[i]!, 0));

            let drawnTotal = 0;
            let taxTaxableRecorded = 0;
            let taxDefenseRecorded = 0;
            if (fromTaxable > 0) {
              const taxableTotal = taxablePaths[i]!;
              const taxablePrincipal = taxableCostBasis[i]!;
              const gainRatio =
                taxableTotal > taxablePrincipal
                  ? (taxableTotal - taxablePrincipal) / taxableTotal
                  : 0;
              const tax = fromTaxable * gainRatio * taxRate;
              taxableCostBasis[i]! *= 1 - Math.min(fromTaxable / taxableTotal, 1);
              taxablePaths[i]! -= fromTaxable + tax;
              if (taxablePaths[i]! < 0) taxablePaths[i] = 0;
              drawnTotal += fromTaxable;
              taxTaxableRecorded = tax;
            }
            if (fromNisa > 0) {
              const nisaTotalLocal = nisaPaths[i]!;
              nisaCostBasis[i]! *= 1 - Math.min(fromNisa / nisaTotalLocal, 1);
              nisaPaths[i]! -= fromNisa;
              if (nisaPaths[i]! < 0) nisaPaths[i] = 0;
              drawnTotal += fromNisa;
            }
            if (fromDefense > 0 && useDefense && defensePaths !== null && defenseCostBasis !== null) {
              const defTotal = defensePaths[i]!;
              const defPrincipal = defenseCostBasis[i]!;
              const gainRatio =
                defTotal > defPrincipal ? (defTotal - defPrincipal) / defTotal : 0;
              const tax = fromDefense * gainRatio * taxRate;
              defenseCostBasis[i]! *= 1 - Math.min(fromDefense / defTotal, 1);
              defensePaths[i]! -= fromDefense + tax;
              if (defensePaths[i]! < 0) defensePaths[i] = 0;
              drawnTotal += fromDefense;
              taxDefenseRecorded = tax;
            }

            cumulativeWithdrawals[i]! += drawnTotal;
            yearlyWithdrawals[i]! += drawnTotal;
            if (recordPivot) {
              monthlyWithdrawalRecorded = drawnTotal;
              withdrawalFromNisaRecorded = fromNisa;
              withdrawalFromTaxableRecorded = fromTaxable;
              withdrawalFromDefenseRecorded = fromDefense;
              withdrawalTaxTaxableRecorded = taxTaxableRecorded;
              withdrawalTaxDefenseRecorded = taxDefenseRecorded;
            }
          }
        }

        const shouldSkipRebalance = skipRebalanceWhenDrawdown && inDrawdown;
        if (
          useDefense &&
          defensePaths !== null &&
          defenseCostBasis !== null &&
          !shouldSkipRebalance &&
          needsRebalance(
            liquidRiskSide + idecoValue,
            defensePaths[i]!,
            dr,
            rebalanceThresholdPoint,
          )
        ) {
          const nisaTotalLocal = nisaPaths[i]!;
          const taxableTotalLocal = taxablePaths[i]!;
          const taxablePrincipalLocal = taxableCostBasis[i]!;
          const defenseTotalLocal = defensePaths[i]!;
          const defensePrincipalLocal = defenseCostBasis[i]!;
          const liquidRiskSideLocal = nisaTotalLocal + taxableTotalLocal;
          const riskSideLocal = liquidRiskSideLocal + idecoValue;
          const totalLocal = riskSideLocal + defenseTotalLocal;
          const targetDefense = dr * totalLocal;
          const delta = targetDefense - defenseTotalLocal;

          if (delta > 0) {
            // iDeCo は売却不可なので売却対象は NISA/特定のみ
            const sellRequested = Math.min(delta, liquidRiskSideLocal);
            const sellFromTaxable = Math.min(sellRequested, taxableTotalLocal);
            const sellFromNisa = sellRequested - sellFromTaxable;
            const gainRatioTaxable =
              taxableTotalLocal > taxablePrincipalLocal
                ? (taxableTotalLocal - taxablePrincipalLocal) / taxableTotalLocal
                : 0;
            const taxTaxable = sellFromTaxable * gainRatioTaxable * taxRate;
            const proceedsTaxable = sellFromTaxable - taxTaxable;
            const proceedsNisa = sellFromNisa;
            const proceeds = proceedsTaxable + proceedsNisa;

            if (sellFromTaxable > 0) {
              taxableCostBasis[i]! *=
                1 - Math.min(sellFromTaxable / taxableTotalLocal, 1);
              taxablePaths[i]! = Math.max(taxableTotalLocal - sellFromTaxable - taxTaxable, 0);
            }
            if (sellFromNisa > 0) {
              nisaCostBasis[i]! *= 1 - Math.min(sellFromNisa / nisaTotalLocal, 1);
              nisaPaths[i]! = Math.max(nisaTotalLocal - sellFromNisa, 0);
            }
            defensePaths[i]! = defenseTotalLocal + proceeds;
            defenseCostBasis[i]! = defensePrincipalLocal + proceeds;
            if (recordPivot) {
              rebalanceInfoRecorded = {
                direction: "risk-to-defense",
                sellAmount: sellRequested,
                taxAmount: taxTaxable,
                proceeds,
                nisaUsed: 0,
              };
            }
          } else if (delta < 0) {
            const sell = Math.min(-delta, defenseTotalLocal);
            const gainRatioDef =
              defenseTotalLocal > defensePrincipalLocal
                ? (defenseTotalLocal - defensePrincipalLocal) / defenseTotalLocal
                : 0;
            const tax = sell * gainRatioDef * taxRate;
            const proceeds = sell - tax;

            defenseCostBasis[i]! *= 1 - Math.min(sell / defenseTotalLocal, 1);
            defensePaths[i]! = Math.max(defenseTotalLocal - sell - tax, 0);

            const annualRemain = Math.max(0, nisaAnnualLimit - yearlyNisaUsed[i]!);
            const lifetimeRemain = Math.max(0, nisaLifetimeLimit - lifetimeNisaUsed[i]!);
            const nisaCap = Math.min(annualRemain, lifetimeRemain);
            const toNisa = Math.min(proceeds, nisaCap);
            const toTaxable = proceeds - toNisa;

            nisaPaths[i]! += toNisa;
            nisaCostBasis[i]! += toNisa;
            taxablePaths[i]! += toTaxable;
            taxableCostBasis[i]! += toTaxable;
            if (toNisa > 0) {
              yearlyNisaUsed[i]! += toNisa;
              lifetimeNisaUsed[i]! += toNisa;
            }
            if (recordPivot) {
              rebalanceInfoRecorded = {
                direction: "defense-to-risk",
                sellAmount: sell,
                taxAmount: tax,
                proceeds,
                nisaUsed: toNisa,
              };
            }
          }
        }

        if (recordPivot) {
          pushPivotRow(keysForMask(pivotMask), {
            year,
            month: m + 1,
            prevNisa,
            prevTaxable,
            prevDefense,
            prevIdeco,
            nisaTotal: nisaPaths[i]!,
            taxableRiskTotal: taxablePaths[i]!,
            defenseTotal:
              useDefense && defensePaths !== null ? defensePaths[i]! : 0,
            idecoTotal: useIdeco ? idecoPaths![i]! : 0,
            monthlyWithdrawal: monthlyWithdrawalRecorded,
            monthlyWithdrawalNisa: withdrawalFromNisaRecorded,
            monthlyWithdrawalTaxableRisk: withdrawalFromTaxableRecorded,
            monthlyWithdrawalDefense: withdrawalFromDefenseRecorded,
            monthlyWithdrawalTaxTaxableRisk: withdrawalTaxTaxableRecorded,
            monthlyWithdrawalTaxDefense: withdrawalTaxDefenseRecorded,
            monthlyPension: pensionRecorded,
            monthlyOtherIncome: otherIncomeRecorded,
            monthlyGainRisk: gainRisk,
            monthlyGainNisa: gainNisa,
            monthlyGainTaxableRisk: gainTaxable,
            monthlyGainDefense: gainDefense,
            monthlyGainIdeco: gainIdeco,
            rebalanceInfo: rebalanceInfoRecorded,
            nisaTransferInfo: m === 0 ? nisaTransferByIndex.get(i) ?? null : null,
            idecoLumpSumInfo: idecoLumpSumRecorded,
            idecoPensionInfo: idecoPensionRecorded,
          });
        }
      }

      if (isWithdrawing && !isAnyRateMode) {
        for (let i = 0; i < N; i++) {
          currentMonthlyWithdrawal[i]! *= monthlyRealWithdrawalFactor;
        }
      }
    }

    for (let i = 0; i < N; i++) {
      let t = nisaPaths[i]! + taxablePaths[i]!;
      if (useDefense && defensePaths !== null) t += defensePaths[i]!;
      if (useIdeco) t += idecoPaths![i]!;
      totalPaths[i] = t;
    }
    let depleted = 0;
    for (let i = 0; i < N; i++) {
      if (totalPaths[i]! <= 0 && cumulativeWithdrawals[i]! > 0) depleted++;
    }
    totalPaths.sort();
    yearlyWithdrawals.sort();
    const q = (p: number) => totalPaths[Math.min(N - 1, Math.floor(N * p))]!;
    yearly.push({
      year,
      age: currentAge + year,
      p10: q(0.1),
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      depletionRate: depleted / N,
      medianYearlyWithdrawal: yearlyWithdrawals[Math.floor(N * 0.5)]!,
    });
  }

  const totalContributed =
    initialTotal + monthlyContribution * 12 * Math.min(contributionYears, totalYears);
  let failureCount = 0;
  const finalTotals = pivotIndices === null ? new Float64Array(N) : null;
  for (let i = 0; i < N; i++) {
    let finalTotal = nisaPaths[i]! + taxablePaths[i]!;
    if (useDefense && defensePaths !== null) finalTotal += defensePaths[i]!;
    if (useIdeco) finalTotal += idecoPaths![i]!;
    if (finalTotals !== null) finalTotals[i] = finalTotal;
    if (finalTotal + cumulativeWithdrawals[i]! < totalContributed) failureCount++;
  }

  return {
    yearly,
    failureProbability: failureCount / N,
    finalTotals,
    pivotMonthlies,
  };
  };

  const phase1 = runSimulation(null);
  const lastYearly = phase1.yearly[phase1.yearly.length - 1]!;
  const finalP50 = lastYearly.p50;

  // 各パーセンタイルの最終値に最も近いパスを同時に特定。フェーズ2 で同じ index を抽出して月次を取得する。
  const finalTotals = phase1.finalTotals!;
  const targets: Record<PercentileKey, number> = {
    p10: lastYearly.p10,
    p25: lastYearly.p25,
    p50: lastYearly.p50,
    p75: lastYearly.p75,
    p90: lastYearly.p90,
  };
  const pivotIndices: Record<PercentileKey, number> = {
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
  };
  const pivotDiffs: Record<PercentileKey, number> = {
    p10: Infinity,
    p25: Infinity,
    p50: Infinity,
    p75: Infinity,
    p90: Infinity,
  };
  for (let i = 0; i < N; i++) {
    const v = finalTotals[i]!;
    for (const k of PERCENTILE_KEYS) {
      const d = Math.abs(v - targets[k]);
      if (d < pivotDiffs[k]) {
        pivotDiffs[k] = d;
        pivotIndices[k] = i;
      }
    }
  }

  const phase2 = runSimulation(pivotIndices);

  return {
    yearly: phase1.yearly,
    failureProbability: phase1.failureProbability,
    depletionProbability: lastYearly.depletionRate,
    finalP50,
    finalP10: lastYearly.p10,
    finalP90: lastYearly.p90,
    pivotMonthlies: phase2.pivotMonthlies,
  };
}

export function computeSecurityScore({
  depletionProbability,
  failureProbability,
  medianFinal,
}: SecurityScoreInput): number {
  let score = (1 - depletionProbability) * 100;
  if (failureProbability != null) score -= failureProbability * 20;
  if (medianFinal <= 0) score = Math.min(score, 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreLabel(score: number): ScoreLabelResult {
  if (score >= 95) return { label: "非常に安心", className: "score-excellent" };
  if (score >= 80) return { label: "安心", className: "score-safe" };
  if (score >= 60) return { label: "やや注意", className: "score-caution" };
  if (score >= 40) return { label: "注意", className: "score-warn" };
  return { label: "要見直し", className: "score-danger" };
}
