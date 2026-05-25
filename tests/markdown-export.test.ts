import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCompound } from "../src/calculate.ts";
import { simulateMonteCarlo, SEED, computeSecurityScore, scoreLabel, type MonteCarloParams } from "../src/monte-carlo.ts";
import { buildMarkdownReport } from "../src/vue/markdown-export.ts";
import { computeMetrics } from "../src/vue/composables/useMetrics.ts";
import type { ParamsState } from "../src/vue/composables/useParams.ts";
import type { SimulatorResult } from "../src/vue/composables/useSimulator.ts";

const MAN = 10000;

function makeBaseState(): ParamsState {
  return {
    currentAge: 45,
    initialNisaMan: 500,
    initialNisaGainMan: 100,
    initialTaxableRiskMan: 1000,
    initialTaxableRiskGainMan: 200,
    initialDefenseMan: 500,
    initialDefenseGainMan: 50,
    nisaInitialLifetimeUsedMan: 500,
    isCoupled: true,
    nisaTransferEnabled: true,
    monthlyContributionMan: 10,
    productPreset: "allcountry",
    annualReturnRate: 7.5,
    expenseRatio: 0.058,
    inflationRate: 2,
    volatility: 15,
    contributionYears: 20,
    withdrawalStartYear: 20,
    withdrawalYears: 30,
    withdrawalMode: "rate",
    fixedMonthlyWithdrawalMan: 25,
    withdrawalRate: 4,
    withdrawalLimitSteps: [{ untilAge: null, floorMan: null, ceilingMan: null }],
    inflationAdjustedWithdrawal: true,
    basePensionMan: 18,
    pensionStartAge: 65,
    defenseProductPreset: "jgb10",
    defenseAnnualReturnRate: 0.5,
    defenseVolatility: 0,
    targetDefenseRatioStartPercent: 25,
    targetDefenseRatioEndPercent: 50,
    glidePathEndAge: 85,
    defensePriorityOnDrawdown: true,
    drawdownThresholdPercent: 20,
    rebalanceThresholdPoint: 5,
    skipRebalanceOnDrawdown: true,
    idecoEnabled: true,
    initialIdecoMan: 200,
    initialIdecoGainMan: 30,
    idecoMonthlyContributionMan: 2.3,
    idecoContributionYears: 5,
    idecoReceiveStartAge: 65,
    idecoLumpSumRatio: 50,
    idecoPensionYears: 10,
    guardrailUpperPercent: 20,
    guardrailLowerPercent: 20,
    guardrailAdjustmentPercent: 10,
    otherIncomes: [],
    lifeEvents: [],
  };
}

function makeBaseParams(): MonteCarloParams {
  return {
    currentAge: 45,
    initialNisa: 500 * MAN,
    initialNisaGain: 100 * MAN,
    initialTaxableRisk: 1000 * MAN,
    initialTaxableRiskGain: 200 * MAN,
    initialDefense: 500 * MAN,
    initialDefenseGain: 50 * MAN,
    nisaInitialLifetimeUsed: 500 * MAN,
    isCoupled: true,
    nisaTransferEnabled: true,
    monthlyContribution: 10 * MAN,
    annualReturnRate: 7.5,
    expenseRatio: 0.058,
    inflationRate: 2,
    volatility: 15,
    contributionYears: 20,
    withdrawalStartYear: 20,
    withdrawalYears: 30,
    withdrawalMode: "rate",
    fixedMonthlyWithdrawal: 25 * MAN,
    withdrawalRate: 4,
    withdrawalLimitSchedule: [{ untilAge: null, floor: null, ceiling: null }],
    inflationAdjustedWithdrawal: true,
    basePension: 18 * MAN,
    pensionStartAge: 65,
    otherIncomes: [],
    defenseAnnualReturnRate: 0.5,
    defenseVolatility: 0,
    targetDefenseRatioStart: 25,
    targetDefenseRatioEnd: 50,
    glidePathEndAge: 85,
    defensePriorityOnDrawdown: true,
    drawdownThresholdPercent: 20,
    rebalanceThresholdPoint: 5,
    skipRebalanceOnDrawdown: true,
    guardrailUpperPercent: 20,
    guardrailLowerPercent: 20,
    guardrailAdjustmentPercent: 10,
    idecoEnabled: true,
    ideco: {
      initialIdeco: 200 * MAN,
      initialIdecoGain: 30 * MAN,
      idecoMonthlyContribution: 2.3 * MAN,
      idecoContributionYears: 5,
      idecoReceiveStartAge: 65,
      idecoLumpSumRatio: 0.5,
      idecoPensionYears: 10,
    },
    enableJumpDiffusion: false,
    lifeEvents: [],
  };
}

function makeResult(params: MonteCarloParams): SimulatorResult {
  const { yearly, monthly } = calculateCompound(params);
  const mc = simulateMonteCarlo(params, SEED);
  const score = computeSecurityScore({
    depletionProbability: mc.depletionProbability,
    failureProbability: mc.failureProbability,
    medianFinal: mc.finalP50,
  });
  return { yearly, monthly, mc, score, scoreInfo: scoreLabel(score) };
}

function render(state: ParamsState, params: MonteCarloParams): string {
  const result = makeResult(params);
  const metrics = computeMetrics(result.yearly, params);
  return buildMarkdownReport(state, params, result, metrics);
}

test("buildMarkdownReport - 見出しと主要セクションが含まれる", () => {
  const md = render(makeBaseState(), makeBaseParams());

  assert.ok(md.includes("# 資産形成・取り崩しシミュレーション結果"));
  assert.ok(md.includes("## 入力条件"));
  assert.ok(md.includes("## 主要メトリクス"));
  assert.ok(md.includes("## モンテカルロ 年次推移"));
  assert.ok(md.includes("## メトリクス用語の説明"));
  assert.ok(md.includes("## 前提・注意"));
});

test("buildMarkdownReport - 入力条件にcurrentAge/contributionYearsが反映される", () => {
  const md = render(makeBaseState(), makeBaseParams());

  assert.ok(md.includes("現在年齢: 45 歳"));
  assert.ok(md.includes("積立期間: 20 年"));
  assert.ok(md.includes("夫婦モード: ON"));
});

test("buildMarkdownReport - MC年次表のヘッダがP10/P50/枯渇率", () => {
  const md = render(makeBaseState(), makeBaseParams());

  assert.ok(md.includes("| 年 | 年齢 | P10 | P50 | 枯渇率 | 備考 |"));
});

test("buildMarkdownReport - 年次表に取崩開始年/iDeCo受取年の備考が出る", () => {
  const md = render(makeBaseState(), makeBaseParams());

  assert.ok(md.includes("取り崩し開始"));
  assert.ok(md.includes("iDeCo受給開始"));
  assert.ok(md.includes("公的年金開始"));
  assert.ok(md.includes("取り崩し終了"));
});

test("buildMarkdownReport - メトリクス用語に枯渇確率が含まれる", () => {
  const md = render(makeBaseState(), makeBaseParams());

  assert.ok(md.includes("**枯渇確率**"));
});

test("buildMarkdownReport - iDeCo OFFのときiDeCoセクションは『なし』表記", () => {
  const state = makeBaseState();
  state.idecoEnabled = false;
  const params = makeBaseParams();
  params.idecoEnabled = false;
  const md = render(state, params);

  assert.ok(md.includes("- なし（無効）"));
  assert.ok(!md.includes("**iDeCo 一時金累計**"));
  assert.ok(!/\|\s*iDeCo\s*\|\s*\d/.test(md));
});

test("buildMarkdownReport - 取り崩しモード4種すべてでラベルが出る", () => {
  const base = makeBaseParams();
  const modes: Array<["amount" | "rate" | "rate-risk" | "rate-guardrail", string]> = [
    ["amount", "定額 月"],
    ["rate", "定率 "],
    ["rate-risk", "定率×リスク"],
    ["rate-guardrail", "GKガードレール"],
  ];
  for (const [mode, fragment] of modes) {
    const state = makeBaseState();
    state.withdrawalMode = mode;
    const md = render(state, { ...base, withdrawalMode: mode });
    assert.ok(md.includes(fragment), `mode=${mode} should include "${fragment}"`);
  }
});

test("buildMarkdownReport - 公的年金なしのとき『なし』表記", () => {
  const state = makeBaseState();
  state.basePensionMan = 0;
  const params = makeBaseParams();
  params.basePension = 0;
  const md = render(state, params);

  assert.ok(md.includes("公的年金: なし"));
});

test("buildMarkdownReport - 夫婦モードOFFでNISA枠表記が1800万になる", () => {
  const state = makeBaseState();
  state.isCoupled = false;
  const params = makeBaseParams();
  params.isCoupled = false;
  const md = render(state, params);

  assert.ok(md.includes("個人枠 1,800 万のうち"));
  assert.ok(!md.includes("夫婦枠"));
});
