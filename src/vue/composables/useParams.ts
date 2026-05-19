import { reactive, computed } from "vue";
import { normalizeOtherIncomes, type OtherIncomeEntry } from "../../other-income.ts";
import type { MonteCarloParams } from "../../monte-carlo.ts";

export type WithdrawalMode = "amount" | "rate" | "rate-risk";

const MAN = 10000;

export interface Preset {
  annualReturnRate: number;
  expenseRatio: number;
  volatility: number;
}

export interface DefensePreset {
  annualReturnRate: number;
  volatility: number;
}

export const PRESETS: Record<string, Preset | null> = {
  custom: null,
  allcountry: { annualReturnRate: 7.5, expenseRatio: 0.05775, volatility: 15 },
  sp500: { annualReturnRate: 10, expenseRatio: 0.0814, volatility: 18 },
  qqq: { annualReturnRate: 12, expenseRatio: 0.2, volatility: 22 },
  nikkei: { annualReturnRate: 7.5, expenseRatio: 0.143, volatility: 20 },
  topix: { annualReturnRate: 6, expenseRatio: 0.143, volatility: 18 },
};

export const DEFENSE_PRESETS: Record<string, DefensePreset | null> = {
  custom: null,
  jgb10: { annualReturnRate: 0.5, volatility: 0 },
  cash: { annualReturnRate: 0.1, volatility: 0 },
};

export interface ParamsState {
  currentAge: number | null;
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
  monthlyWithdrawalFloorMan: number | null;
  monthlyWithdrawalCeilingMan: number | null;
  inflationAdjustedWithdrawal: boolean;
  basePensionMan: number;
  pensionStartAge: number;
  defenseProductPreset: string;
  defenseAnnualReturnRate: number;
  defenseVolatility: number;
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

export const DEFAULT_PARAMS: Omit<ParamsState, "otherIncomes"> & { otherIncomes: never[] } = {
  currentAge: null,
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
  monthlyWithdrawalFloorMan: null,
  monthlyWithdrawalCeilingMan: null,
  inflationAdjustedWithdrawal: false,
  basePensionMan: 0,
  pensionStartAge: 65,
  defenseProductPreset: "jgb10",
  defenseAnnualReturnRate: 0.5,
  defenseVolatility: 0,
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
  otherIncomes: [],
};

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
      monthlyWithdrawalFloor:
        state.monthlyWithdrawalFloorMan != null ? state.monthlyWithdrawalFloorMan * MAN : null,
      monthlyWithdrawalCeiling:
        state.monthlyWithdrawalCeilingMan != null ? state.monthlyWithdrawalCeilingMan * MAN : null,
      inflationAdjustedWithdrawal: state.inflationAdjustedWithdrawal,
      basePension: state.basePensionMan * MAN,
      pensionStartAge: state.pensionStartAge,
      otherIncomes: normalizeOtherIncomes(state.otherIncomes, state.currentAge, totalYears, MAN),
      defenseAnnualReturnRate: state.defenseAnnualReturnRate,
      defenseVolatility: state.defenseVolatility,
      defensePriorityOnDrawdown: state.defensePriorityOnDrawdown,
      drawdownThresholdPercent: state.drawdownThresholdPercent,
      rebalanceThresholdPoint: state.rebalanceThresholdPoint,
      skipRebalanceOnDrawdown: state.skipRebalanceOnDrawdown,
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

  return {
    state,
    mcParams,
    applyProductPreset,
    applyDefensePreset,
    addOtherIncome,
    removeOtherIncome,
    MAN,
  };
}

export type UseParams = ReturnType<typeof useParams>;
