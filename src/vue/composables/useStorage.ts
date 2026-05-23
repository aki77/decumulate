import { watchDebounced } from "@vueuse/core";
import type { OtherIncomeEntry } from "../../other-income.ts";
import type { ParamsState, WithdrawalLimitStepInput } from "./useParams.ts";

const STORAGE_KEY = "decumulate:inputs";
const LEGACY_V8_KEY = "decumulate:inputs:v8";

export const CURRENT_VERSION = 8 as const;

export interface Migration {
  from: number;
  to: number;
  migrate: (data: any) => any;
}

export const MIGRATIONS: readonly Migration[] = [];

export interface StoragePayload {
  version: number;
  data: unknown;
}

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

export function parseStoredState(data: unknown): Partial<StoredState> | null {
  if (!data || typeof data !== "object") return null;
  const src = data as Record<string, unknown>;
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
    const v = src[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      (result as Record<string, unknown>)[key] = v;
    }
  }

  for (const key of boolFields) {
    const v = src[key];
    if (typeof v === "boolean") (result as Record<string, unknown>)[key] = v;
  }

  for (const key of strFields) {
    const v = src[key];
    if (typeof v === "string") (result as Record<string, unknown>)[key] = v;
  }

  const rawOi = src["otherIncomes"];
  if (Array.isArray(rawOi)) {
    result.otherIncomes = rawOi.filter(isOtherIncomeEntry);
  }

  const rawSteps = src["withdrawalLimitSteps"];
  if (Array.isArray(rawSteps)) {
    const filtered = rawSteps.filter(isWithdrawalLimitStep);
    // 終端行（untilAge=null）が無い壊れデータからは復元しない（デフォルトに任せる）
    if (filtered.some((s) => s.untilAge === null)) {
      result.withdrawalLimitSteps = filtered;
    }
  }

  return result;
}

export function asStoragePayload(parsed: unknown): StoragePayload | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o["version"] !== "number" || !Number.isFinite(o["version"])) return null;
  if (!("data" in o)) return null;
  return { version: o["version"] as number, data: o["data"] };
}

export function migrateWith(
  payload: StoragePayload,
  migrations: readonly Migration[],
  currentVersion: number,
): Partial<StoredState> | null {
  let version = payload.version;
  let data = payload.data;

  if (version > currentVersion) return null;

  while (version < currentVersion) {
    const m = migrations.find((mig) => mig.from === version);
    if (!m) return null;
    data = m.migrate(data);
    version = m.to;
  }

  return parseStoredState(data);
}

function migrateToCurrent(payload: StoragePayload): Partial<StoredState> | null {
  return migrateWith(payload, MIGRATIONS, CURRENT_VERSION);
}

function migrateLegacyV8KeyIfNeeded(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== null) return;
    const legacy = localStorage.getItem(LEGACY_V8_KEY);
    if (!legacy) return;
    const data = JSON.parse(legacy);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 8, data }),
    );
    localStorage.removeItem(LEGACY_V8_KEY);
  } catch {}
}

function loadFromStorage(): Partial<StoredState> | null {
  try {
    migrateLegacyV8KeyIfNeeded();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const payload = asStoragePayload(parsed);
    if (!payload) return null;
    return migrateToCurrent(payload);
  } catch {
    return null;
  }
}

function saveToStorage(state: ParamsState): void {
  try {
    const payload: StoragePayload = { version: CURRENT_VERSION, data: state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
    const payload: StoragePayload = { version: CURRENT_VERSION, data: state };
    return JSON.stringify(payload, null, 2);
  }

  function importData(raw: string): boolean {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const payload = asStoragePayload(parsed);
      if (!payload) return false;
      const migrated = migrateToCurrent(payload);
      if (!migrated) return false;
      Object.assign(state, migrated);
      return true;
    } catch {
      return false;
    }
  }

  return { load, reset, startAutoSave, exportData, importData };
}
