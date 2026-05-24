import { reactive, computed, ref, watch } from "vue";
import { refDebounced } from "@vueuse/core";
import { normalizeOtherIncomes, type OtherIncomeEntry } from "../../other-income.ts";
import type { WithdrawalLimitStep } from "../../calculate.ts";
import type { MonteCarloParams } from "../../monte-carlo.ts";
import { findSafeWithdrawalRate, type SwrSearchResult } from "../../swr.ts";
import {
  buildZeroLandingSchedule,
  findZeroLandingMonthly,
  type ZeroLandingCurve,
  type ZeroLandingResult,
} from "../../zero-landing.ts";

export type WithdrawalMode = "amount" | "rate" | "rate-risk" | "rate-guardrail" | "zero-landing";

// UI 入力用の年齢ステップ。万円・年齢入力。末尾の 1 行は untilAge=null（「以降」）。
export interface WithdrawalLimitStepInput {
  untilAge: number | null;
  floorMan: number | null;
  ceilingMan: number | null;
}

const MAN = 10000;
const DEBOUNCE_MS = 200;

export interface Preset {
  label: string;
  annualReturnRate: number;
  expenseRatio: number;
  volatility: number;
}

export interface DefensePreset {
  label: string;
  annualReturnRate: number;
  volatility: number;
}

export const PRESETS: Record<string, Preset | null> = {
  custom: null,
  allcountry: { label: "全世界（オルカン）", annualReturnRate: 6.0, expenseRatio: 0.05775, volatility: 17 },
  sp500: { label: "S&P500", annualReturnRate: 7.0, expenseRatio: 0.0814, volatility: 20 },
  qqq: { label: "QQQ", annualReturnRate: 8.0, expenseRatio: 0.2, volatility: 25 },
  nikkei: { label: "日経平均", annualReturnRate: 5.5, expenseRatio: 0.143, volatility: 20 },
  topix: { label: "TOPIX", annualReturnRate: 5.0, expenseRatio: 0.143, volatility: 18 },
};

export const DEFENSE_PRESETS: Record<string, DefensePreset | null> = {
  custom: null,
  jgb10: { label: "個人向け国債変動10年", annualReturnRate: 0.8, volatility: 0 },
  cash: { label: "現金・普通預金", annualReturnRate: 0.1, volatility: 0 },
};

export interface ParamsState {
  currentAge: number;
  initialNisaMan: number;
  initialNisaGainMan: number;
  initialTaxableRiskMan: number;
  initialTaxableRiskGainMan: number;
  initialDefenseMan: number;
  initialDefenseGainMan: number;
  nisaInitialLifetimeUsedMan: number;
  isCoupled: boolean;
  nisaTransferEnabled: boolean;
  monthlyContributionMan: number;
  productPreset: string;
  annualReturnRate: number;
  expenseRatio: number;
  inflationRate: number;
  volatility: number;
  contributionYears: number;
  withdrawalStartYear: number;
  withdrawalYears: number;
  withdrawalMode: WithdrawalMode;
  fixedMonthlyWithdrawalMan: number;
  withdrawalRate: number;
  withdrawalLimitSteps: WithdrawalLimitStepInput[];
  inflationAdjustedWithdrawal: boolean;
  basePensionMan: number;
  pensionStartAge: number;
  defenseProductPreset: string;
  defenseAnnualReturnRate: number;
  defenseVolatility: number;
  targetDefenseRatioStartPercent: number;
  targetDefenseRatioEndPercent: number;
  glidePathEndAge: number;
  defensePriorityOnDrawdown: boolean;
  drawdownThresholdPercent: number;
  rebalanceThresholdPoint: number;
  skipRebalanceOnDrawdown: boolean;
  idecoEnabled: boolean;
  initialIdecoMan: number;
  initialIdecoGainMan: number;
  idecoMonthlyContributionMan: number;
  idecoContributionYears: number;
  idecoReceiveStartAge: number;
  idecoLumpSumRatio: number;
  idecoPensionYears: number;
  guardrailUpperPercent: number;
  guardrailLowerPercent: number;
  guardrailAdjustmentPercent: number;
  finalTargetMan: number;
  minMonthlyWithdrawalMan: number;
  slowGoStartAge: number;
  noGoStartAge: number;
  slowGoCoefPercent: number;
  otherIncomes: OtherIncomeEntry[];
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `oi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeDefaultOtherIncomeEntry(): OtherIncomeEntry {
  return {
    id: newId(),
    label: "",
    amountMan: 0,
    amountMode: "monthly",
    startAge: null,
    endAge: null,
  };
}

export const DEFAULT_PARAMS: Omit<ParamsState, "otherIncomes" | "withdrawalLimitSteps"> & {
  otherIncomes: never[];
  withdrawalLimitSteps: WithdrawalLimitStepInput[];
} = {
  currentAge: 40,
  initialNisaMan: 0,
  initialNisaGainMan: 0,
  initialTaxableRiskMan: 0,
  initialTaxableRiskGainMan: 0,
  initialDefenseMan: 0,
  initialDefenseGainMan: 0,
  nisaInitialLifetimeUsedMan: 0,
  isCoupled: false,
  nisaTransferEnabled: false,
  monthlyContributionMan: 5,
  productPreset: "custom",
  annualReturnRate: 5,
  expenseRatio: 0.1,
  inflationRate: 2,
  volatility: 15,
  contributionYears: 30,
  withdrawalStartYear: 30,
  withdrawalYears: 30,
  withdrawalMode: "amount",
  fixedMonthlyWithdrawalMan: 25,
  withdrawalRate: 4,
  withdrawalLimitSteps: [{ untilAge: null, floorMan: null, ceilingMan: null }],
  inflationAdjustedWithdrawal: false,
  basePensionMan: 0,
  pensionStartAge: 65,
  defenseProductPreset: "jgb10",
  defenseAnnualReturnRate: 0.5,
  defenseVolatility: 0,
  targetDefenseRatioStartPercent: 0,
  targetDefenseRatioEndPercent: 0,
  glidePathEndAge: 65,
  defensePriorityOnDrawdown: true,
  drawdownThresholdPercent: 10,
  rebalanceThresholdPoint: 5,
  skipRebalanceOnDrawdown: true,
  idecoEnabled: false,
  initialIdecoMan: 0,
  initialIdecoGainMan: 0,
  idecoMonthlyContributionMan: 0,
  idecoContributionYears: 0,
  idecoReceiveStartAge: 65,
  idecoLumpSumRatio: 100,
  idecoPensionYears: 10,
  guardrailUpperPercent: 20,
  guardrailLowerPercent: 20,
  guardrailAdjustmentPercent: 10,
  finalTargetMan: 0,
  minMonthlyWithdrawalMan: 15,
  slowGoStartAge: 75,
  noGoStartAge: 85,
  slowGoCoefPercent: 80,
  otherIncomes: [],
};

// UI 入力の steps を計算層に渡せる schedule に正規化する。
// - 万円→円
// - untilAge 昇順ソート（数値の行のみ。null は終端として末尾に固定）
// - 末尾は必ず untilAge=null の 1 行（無ければ補う、複数あれば 1 行に統合）
function toLimitStep(s: WithdrawalLimitStepInput): WithdrawalLimitStep {
  return {
    untilAge: s.untilAge,
    floor: s.floorMan != null ? s.floorMan * MAN : null,
    ceiling: s.ceilingMan != null ? s.ceilingMan * MAN : null,
  };
}

// UI 不変条件: 配列の最終要素のみが終端行（untilAge は値に関わらず無視）。
// 非終端行で untilAge が空欄（null）のものは入力途中とみなして drop する。
function normalizeLimitSteps(steps: WithdrawalLimitStepInput[]): WithdrawalLimitStep[] {
  if (steps.length === 0) {
    return [toLimitStep({ untilAge: null, floorMan: null, ceilingMan: null })];
  }
  const terminal = steps[steps.length - 1]!;
  const finite = steps
    .slice(0, -1)
    .filter((s): s is WithdrawalLimitStepInput & { untilAge: number } => s.untilAge !== null)
    .sort((a, b) => a.untilAge - b.untilAge);
  return [...finite.map(toLimitStep), toLimitStep({ ...terminal, untilAge: null })];
}

function extractZeroLandingCurve(state: ParamsState): ZeroLandingCurve {
  return {
    slowGoStartAge: state.slowGoStartAge,
    noGoStartAge: state.noGoStartAge,
    slowGoCoef: state.slowGoCoefPercent / 100,
    noGoMonthly: state.minMonthlyWithdrawalMan * MAN,
  };
}

export function useParams() {
  const state = reactive<ParamsState>({ ...DEFAULT_PARAMS });

  const mcParams = computed<MonteCarloParams>(() => {
    const totalYears = Math.max(
      state.contributionYears,
      state.withdrawalStartYear + state.withdrawalYears,
    );
    return {
      currentAge: state.currentAge,
      initialNisa: state.initialNisaMan * MAN,
      initialNisaGain: state.initialNisaGainMan * MAN,
      initialTaxableRisk: state.initialTaxableRiskMan * MAN,
      initialTaxableRiskGain: state.initialTaxableRiskGainMan * MAN,
      initialDefense: state.initialDefenseMan * MAN,
      initialDefenseGain: state.initialDefenseGainMan * MAN,
      nisaInitialLifetimeUsed: state.nisaInitialLifetimeUsedMan * MAN,
      isCoupled: state.isCoupled,
      nisaTransferEnabled: state.nisaTransferEnabled,
      monthlyContribution: state.monthlyContributionMan * MAN,
      annualReturnRate: state.annualReturnRate,
      expenseRatio: state.expenseRatio,
      inflationRate: state.inflationRate,
      volatility: state.volatility,
      contributionYears: state.contributionYears,
      withdrawalStartYear: state.withdrawalStartYear,
      withdrawalYears: state.withdrawalYears,
      withdrawalMode: state.withdrawalMode,
      fixedMonthlyWithdrawal: state.fixedMonthlyWithdrawalMan * MAN,
      withdrawalRate: state.withdrawalRate,
      withdrawalLimitSchedule: normalizeLimitSteps(state.withdrawalLimitSteps),
      inflationAdjustedWithdrawal: state.inflationAdjustedWithdrawal,
      basePension: state.basePensionMan * MAN,
      pensionStartAge: state.pensionStartAge,
      otherIncomes: normalizeOtherIncomes(state.otherIncomes, state.currentAge, totalYears, MAN),
      defenseAnnualReturnRate: state.defenseAnnualReturnRate,
      defenseVolatility: state.defenseVolatility,
      targetDefenseRatioStart: state.targetDefenseRatioStartPercent,
      targetDefenseRatioEnd: state.targetDefenseRatioEndPercent,
      glidePathEndAge: state.glidePathEndAge,
      defensePriorityOnDrawdown: state.defensePriorityOnDrawdown,
      drawdownThresholdPercent: state.drawdownThresholdPercent,
      rebalanceThresholdPoint: state.rebalanceThresholdPoint,
      skipRebalanceOnDrawdown: state.skipRebalanceOnDrawdown,
      guardrailUpperPercent: state.guardrailUpperPercent,
      guardrailLowerPercent: state.guardrailLowerPercent,
      guardrailAdjustmentPercent: state.guardrailAdjustmentPercent,
      zeroLandingCurve: state.withdrawalMode === "zero-landing" ? extractZeroLandingCurve(state) : undefined,
      idecoEnabled: state.idecoEnabled,
      ideco: {
        initialIdeco: state.initialIdecoMan * MAN,
        initialIdecoGain: state.initialIdecoGainMan * MAN,
        idecoMonthlyContribution: state.idecoMonthlyContributionMan * MAN,
        idecoContributionYears: state.idecoContributionYears,
        idecoReceiveStartAge: state.idecoReceiveStartAge,
        idecoLumpSumRatio: state.idecoLumpSumRatio / 100,
        idecoPensionYears: state.idecoPensionYears,
      },
    };
  });

  const debouncedMcParams = refDebounced(mcParams, DEBOUNCE_MS);

  function applyProductPreset(presetKey: string): void {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    state.annualReturnRate = preset.annualReturnRate;
    state.expenseRatio = preset.expenseRatio;
    state.volatility = preset.volatility;
  }

  function applyDefensePreset(presetKey: string): void {
    const preset = DEFENSE_PRESETS[presetKey];
    if (!preset) return;
    state.defenseAnnualReturnRate = preset.annualReturnRate;
    state.defenseVolatility = preset.volatility;
  }

  function addOtherIncome(): void {
    state.otherIncomes.push(makeDefaultOtherIncomeEntry());
  }

  function removeOtherIncome(id: string): void {
    const idx = state.otherIncomes.findIndex((e) => e.id === id);
    if (idx !== -1) state.otherIncomes.splice(idx, 1);
  }

  // 終端行（配列の最終要素）の直前に新しいステップを挿入する。
  // 既存の最後の有限 untilAge より +5 歳を初期値にして、追加直後でも昇順を保つ。
  function addLimitStep(): void {
    const list = state.withdrawalLimitSteps;
    let suggestedAge = state.currentAge + 10;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]!.untilAge;
      if (a !== null && a >= suggestedAge) suggestedAge = a + 5;
    }
    list.splice(Math.max(0, list.length - 1), 0, {
      untilAge: suggestedAge,
      floorMan: null,
      ceilingMan: null,
    });
  }

  function removeLimitStep(idx: number): void {
    const list = state.withdrawalLimitSteps;
    // 終端 = 最終要素なので削除不可
    if (idx < 0 || idx >= list.length - 1) return;
    list.splice(idx, 1);
  }

  const isComputingSwr = ref(false);

  async function runSwrSearch(): Promise<SwrSearchResult> {
    if (isComputingSwr.value) throw new Error("SWR search already running");
    isComputingSwr.value = true;
    // 「計算中…」描画にフレームを譲ってから ~900ms の同期 MC ループへ
    await new Promise<void>((r) => setTimeout(r, 0));
    try {
      const result = findSafeWithdrawalRate(mcParams.value);
      if (result.rate !== state.withdrawalRate) {
        state.withdrawalRate = result.rate;
      }
      return result;
    } finally {
      isComputingSwr.value = false;
    }
  }

  const isComputingZeroLanding = ref(false);

  // zero-landing モードはソルバーが inflationAdjustedWithdrawal=true を前提に逆算する。
  // UI と計算の食い違いを避けるため、モード切替時に state 側を真に揃える（チェックボックスは disabled 表示）。
  watch(
    () => state.withdrawalMode,
    (mode) => {
      if (mode === "zero-landing" && !state.inflationAdjustedWithdrawal) {
        state.inflationAdjustedWithdrawal = true;
      }
    },
    { immediate: true },
  );

  async function runZeroLandingSolver(): Promise<ZeroLandingResult> {
    if (isComputingZeroLanding.value) throw new Error("Zero-landing solver already running");
    isComputingZeroLanding.value = true;
    await new Promise<void>((r) => setTimeout(r, 0));
    try {
      const result = findZeroLandingMonthly(mcParams.value, {
        finalTarget: state.finalTargetMan * MAN,
        curve: extractZeroLandingCurve(state),
      });
      if (result.boundary === "found") {
        // 探索精度 1000 円を維持するため 0.1 万円単位で丸める。
        const goGoMonthly = Math.round(result.monthlyAmount / 1000) * 1000;
        state.fixedMonthlyWithdrawalMan = goGoMonthly / MAN;
        state.withdrawalLimitSteps = buildZeroLandingSchedule(goGoMonthly, extractZeroLandingCurve(state)).map(
          (s) => ({
            untilAge: s.untilAge,
            floorMan: s.floor != null ? s.floor / MAN : null,
            ceilingMan: s.ceiling != null ? s.ceiling / MAN : null,
          }),
        );
      }
      return result;
    } finally {
      isComputingZeroLanding.value = false;
    }
  }

  return {
    state,
    debouncedMcParams,
    applyProductPreset,
    applyDefensePreset,
    addOtherIncome,
    removeOtherIncome,
    addLimitStep,
    removeLimitStep,
    isComputingSwr,
    runSwrSearch,
    isComputingZeroLanding,
    runZeroLandingSolver,
    MAN,
  };
}
