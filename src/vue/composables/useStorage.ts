import { watch } from "vue";
import type { OtherIncomeEntry } from "../../other-income.ts";
import type { ParamsState } from "./useParams.ts";

const STORAGE_KEY = "decumulate:inputs:v3";

type StoredState = Omit<ParamsState, "otherIncomes"> & { otherIncomes: OtherIncomeEntry[] };

function isOtherIncomeEntry(v: unknown): v is OtherIncomeEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["id"] === "string" &&
    typeof o["label"] === "string" &&
    typeof o["amountMan"] === "number" &&
    (o["amountMode"] === "monthly" || o["amountMode"] === "annual") &&
    (o["startAge"] === null || typeof o["startAge"] === "number") &&
    (o["endAge"] === null || typeof o["endAge"] === "number")
  );
}

function loadFromStorage(): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;

    const result: Partial<StoredState> = {};

    const numFields = [
      "initialNisaMan", "initialNisaGainMan", "initialTaxableRiskMan",
      "initialTaxableRiskGainMan", "initialDefenseMan", "initialDefenseGainMan",
      "nisaInitialLifetimeUsedMan", "monthlyContributionMan", "annualReturnRate",
      "expenseRatio", "inflationRate", "volatility", "contributionYears",
      "withdrawalStartYear", "withdrawalYears", "fixedMonthlyWithdrawalMan",
      "withdrawalRate", "monthlyWithdrawalFloorMan", "monthlyWithdrawalCeilingMan",
      "basePensionMan", "pensionStartAge", "defenseAnnualReturnRate", "defenseVolatility",
      "targetDefenseRatioPercent",
      "drawdownThresholdPercent", "rebalanceThresholdPoint",
      "initialIdecoMan", "initialIdecoGainMan", "idecoMonthlyContributionMan",
      "idecoContributionYears", "idecoReceiveStartAge", "idecoLumpSumRatio", "idecoPensionYears",
    ] as const;

    const boolFields = [
      "isCoupled", "nisaTransferEnabled", "inflationAdjustedWithdrawal",
      "defensePriorityOnDrawdown", "skipRebalanceOnDrawdown", "idecoEnabled",
    ] as const;

    const strFields = ["productPreset", "defenseProductPreset", "withdrawalMode"] as const;

    for (const key of numFields) {
      const v = data[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        (result as Record<string, unknown>)[key] = v;
      } else if (v === null && (key === "monthlyWithdrawalFloorMan" || key === "monthlyWithdrawalCeilingMan")) {
        (result as Record<string, unknown>)[key] = null;
      }
    }

    for (const key of boolFields) {
      const v = data[key];
      if (typeof v === "boolean") (result as Record<string, unknown>)[key] = v;
    }

    for (const key of strFields) {
      const v = data[key];
      if (typeof v === "string") (result as Record<string, unknown>)[key] = v;
    }

    const currentAgeRaw = data["currentAge"];
    if (currentAgeRaw === null || typeof currentAgeRaw === "number") {
      result.currentAge = currentAgeRaw ?? null;
    }

    const rawOi = data["otherIncomes"];
    if (Array.isArray(rawOi)) {
      result.otherIncomes = rawOi.filter(isOtherIncomeEntry);
    }

    return result;
  } catch {
    return null;
  }
}

function saveToStorage(state: ParamsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function useStorage(state: ParamsState) {
  function load(): boolean {
    const saved = loadFromStorage();
    if (!saved) return false;
    Object.assign(state, saved);
    return true;
  }

  function reset(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  function startAutoSave(): void {
    watch(state, (newState) => saveToStorage(newState), { deep: true });
  }

  return { load, reset, startAutoSave };
}
