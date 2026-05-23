import { watchDebounced } from "@vueuse/core";
import type { OtherIncomeEntry } from "../../other-income.ts";
import type { ParamsState, WithdrawalLimitStepInput } from "./useParams.ts";

const STORAGE_KEY = "decumulate:inputs:v8";

type StoredState = Omit<ParamsState, "otherIncomes" | "withdrawalLimitSteps"> & {
  otherIncomes: OtherIncomeEntry[];
  withdrawalLimitSteps: WithdrawalLimitStepInput[];
};

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

function isWithdrawalLimitStep(v: unknown): v is WithdrawalLimitStepInput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o["untilAge"] === null || typeof o["untilAge"] === "number") &&
    (o["floorMan"] === null || typeof o["floorMan"] === "number") &&
    (o["ceilingMan"] === null || typeof o["ceilingMan"] === "number")
  );
}

function parseStoredData(raw: string): Partial<StoredState> | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;

    const result: Partial<StoredState> = {};

    const numFields = [
      "currentAge",
      "initialNisaMan", "initialNisaGainMan", "initialTaxableRiskMan",
      "initialTaxableRiskGainMan", "initialDefenseMan", "initialDefenseGainMan",
      "nisaInitialLifetimeUsedMan", "monthlyContributionMan", "annualReturnRate",
      "expenseRatio", "inflationRate", "volatility", "contributionYears",
      "withdrawalStartYear", "withdrawalYears", "fixedMonthlyWithdrawalMan",
      "withdrawalRate",
      "basePensionMan", "pensionStartAge", "defenseAnnualReturnRate", "defenseVolatility",
      "targetDefenseRatioStartPercent", "targetDefenseRatioEndPercent", "glidePathEndAge",
      "drawdownThresholdPercent", "rebalanceThresholdPoint",
      "initialIdecoMan", "initialIdecoGainMan", "idecoMonthlyContributionMan",
      "idecoContributionYears", "idecoReceiveStartAge", "idecoLumpSumRatio", "idecoPensionYears",
      "guardrailUpperPercent", "guardrailLowerPercent", "guardrailAdjustmentPercent",
      "finalTargetMan",
      "minMonthlyWithdrawalMan", "slowGoStartAge", "noGoStartAge",
      "slowGoCoefPercent",
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

    const rawOi = data["otherIncomes"];
    if (Array.isArray(rawOi)) {
      result.otherIncomes = rawOi.filter(isOtherIncomeEntry);
    }

    const rawSteps = data["withdrawalLimitSteps"];
    if (Array.isArray(rawSteps)) {
      const filtered = rawSteps.filter(isWithdrawalLimitStep);
      // 終端行（untilAge=null）が無い壊れデータからは復元しない（デフォルトに任せる）
      if (filtered.some((s) => s.untilAge === null)) {
        result.withdrawalLimitSteps = filtered;
      }
    }

    return result;
  } catch {
    return null;
  }
}

function loadFromStorage(): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseStoredData(raw);
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
    watchDebounced(state, (newState) => saveToStorage(newState), {
      deep: true,
      debounce: 200,
    });
  }

  function exportData(): string {
    return JSON.stringify(state);
  }

  function importData(raw: string): boolean {
    const parsed = parseStoredData(raw);
    if (!parsed) return false;
    Object.assign(state, parsed);
    return true;
  }

  return { load, reset, startAutoSave, exportData, importData };
}
