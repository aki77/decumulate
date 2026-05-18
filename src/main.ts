import {
  calculateCompound,
  type CalculateParams,
  type MonthlyProjection,
  type YearlyProjection,
} from "./calculate.ts";
import {
  simulateMonteCarlo,
  computeSecurityScore,
  scoreLabel,
  type MonteCarloParams,
} from "./monte-carlo.ts";

interface Preset {
  annualReturnRate: number;
  expenseRatio: number;
  volatility: number;
}

interface DefensePreset {
  annualReturnRate: number;
  volatility: number;
}

const PRESETS: Record<string, Preset | null> = {
  custom: null,
  allcountry: { annualReturnRate: 7.5, expenseRatio: 0.05775, volatility: 15 },
  sp500: { annualReturnRate: 10, expenseRatio: 0.0814, volatility: 18 },
  qqq: { annualReturnRate: 12, expenseRatio: 0.2, volatility: 22 },
  nikkei: { annualReturnRate: 7.5, expenseRatio: 0.143, volatility: 20 },
  topix: { annualReturnRate: 6, expenseRatio: 0.143, volatility: 18 },
};

const DEFENSE_PRESETS: Record<string, DefensePreset | null> = {
  custom: null,
  jgb10: { annualReturnRate: 0.5, volatility: 0 },
  cash: { annualReturnRate: 0.1, volatility: 0 },
};

const MAN = 10000;

const STORAGE_KEY = "decumulate:inputs:v1";

const PERSIST_IDS = [
  "currentAge",
  "initialAmount",
  "monthlyContribution",
  "productPreset",
  "annualReturnRate",
  "expenseRatio",
  "inflationRate",
  "volatility",
  "contributionYears",
  "withdrawalStartYear",
  "withdrawalYears",
  "withdrawalMode",
  "fixedMonthlyWithdrawal",
  "withdrawalRate",
  "inflationAdjustedWithdrawal",
  "taxFree",
  "basePension",
  "pensionStartAge",
  "monthlyOtherIncome",
  "defenseRatio",
  "defenseProductPreset",
  "defenseAnnualReturnRate",
  "defenseVolatility",
  "defensePriorityOnDrawdown",
  "drawdownThresholdPercent",
  "rebalanceThresholdPoint",
  "skipRebalanceOnDrawdown",
];

const HELP: Record<string, string> = {
  score: "枯渇確率・元本割れ確率・中央値残高から算出した 0–100 の総合指標。高いほど安心。",
  totalContrib: "初期投資額 + 月額積立 × 12 × 積立年数。自身が拠出した元本の合計。",
  finalTotal: "シミュレーション最終年の名目資産（インフレ調整なし）。",
  interest: "最終時点の元本超過分（運用益）。非課税口座でない場合は税金控除済み。",
  tax: "特定口座を想定した含み益への課税（20.315%）の累計概算。",
  totalWithdrawn: "取り崩し期間中に引き出した金額の合計（名目値）。",
  mcP50: "モンテカルロ 5,000 試行の最終資産分布の中央値。インフレ控除後の購買力ベース。",
  mcP10: "最終資産分布の下位 10% タイル。下振れシナリオの目安。",
  mcP90: "最終資産分布の上位 10% タイル。上振れシナリオの目安。",
  depletion: "取り崩し期間中に資産がゼロになる試行の割合。",
  failure: "最終資産が積立元本合計を下回る試行の割合。",
};

function helpIcon(text: string): string {
  return `<span class="help-icon" tabindex="0" aria-label="ヘルプ">?<span class="help-tip">${text}</span></span>`;
}

function readNumber(id: string, fallback = 0): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return fallback;
  const raw = el.value;
  if (raw === "" || raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readMan(id: string, fallbackMan = 0): number {
  return readNumber(id, fallbackMan) * MAN;
}

function readChecked(id: string): boolean {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.checked : false;
}

function readSelect(id: string): string | null {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  return el ? el.value : null;
}

function readParams(): MonteCarloParams {
  const currentAgeEl = document.getElementById("currentAge") as HTMLInputElement;
  const currentAgeRaw = currentAgeEl.value;
  return {
    currentAge: currentAgeRaw === "" ? null : Number(currentAgeRaw),
    initialAmount: readMan("initialAmount", 0),
    monthlyContribution: readMan("monthlyContribution", 5),
    annualReturnRate: readNumber("annualReturnRate", 5),
    expenseRatio: readNumber("expenseRatio", 0.1),
    inflationRate: readNumber("inflationRate", 2),
    volatility: readNumber("volatility", 15),
    contributionYears: readNumber("contributionYears", 30),
    withdrawalStartYear: readNumber("withdrawalStartYear", 30),
    withdrawalYears: readNumber("withdrawalYears", 30),
    withdrawalMode: (readSelect("withdrawalMode") || "amount") as
      | "amount"
      | "rate"
      | "rate-risk",
    fixedMonthlyWithdrawal: readMan("fixedMonthlyWithdrawal", 25),
    withdrawalRate: readNumber("withdrawalRate", 4),
    inflationAdjustedWithdrawal: readChecked("inflationAdjustedWithdrawal"),
    taxFree: readChecked("taxFree"),
    basePension: readMan("basePension", 0),
    pensionStartAge: readNumber("pensionStartAge", 65),
    monthlyOtherIncome: readMan("monthlyOtherIncome", 0),
    defenseRatio: readNumber("defenseRatio", 0),
    defenseAnnualReturnRate: readNumber("defenseAnnualReturnRate", 0.5),
    defenseVolatility: readNumber("defenseVolatility", 0),
    defensePriorityOnDrawdown: readChecked("defensePriorityOnDrawdown"),
    drawdownThresholdPercent: readNumber("drawdownThresholdPercent", 10),
    rebalanceThresholdPoint: readNumber("rebalanceThresholdPoint", 5),
    skipRebalanceOnDrawdown: readChecked("skipRebalanceOnDrawdown"),
  };
}

const toMan = (v: number) => v / MAN;

function formatManValue(manValue: number): string {
  if (!Number.isFinite(manValue)) return "-";
  return `${Math.round(manValue).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万円`;
}

function formatMan(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  return formatManValue(toMan(yen));
}

function formatPercent(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Chart: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let compoundChart: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mcChart: any = null;

function renderCompoundChart(
  projections: YearlyProjection[],
  params: CalculateParams,
): void {
  const canvas = document.getElementById("compoundChart") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const labels = projections.map((p) => (p.age != null ? `${p.age}歳` : `${p.year}年`));
  const principal = projections.map((p) => toMan(p.principal));
  const interest = projections.map((p) => toMan(p.interest));
  const tax = projections.map((p) => toMan(p.tax));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annotations: Record<string, any> = {};
  if (params.contributionYears > 0 && params.contributionYears <= projections.length - 1) {
    annotations["contribEnd"] = {
      type: "line",
      xMin: params.contributionYears,
      xMax: params.contributionYears,
      borderColor: "rgba(34, 197, 94, 0.6)",
      borderWidth: 2,
      borderDash: [6, 6],
      label: { display: true, content: "積立終了", position: "start" },
    };
  }
  if (params.withdrawalStartYear > 0 && params.withdrawalStartYear <= projections.length - 1) {
    annotations["withdrawStart"] = {
      type: "line",
      xMin: params.withdrawalStartYear,
      xMax: params.withdrawalStartYear,
      borderColor: "rgba(239, 68, 68, 0.6)",
      borderWidth: 2,
      borderDash: [6, 6],
      label: { display: true, content: "切崩開始", position: "start" },
    };
  }

  const data = {
    labels,
    datasets: [
      {
        label: "元本",
        data: principal,
        backgroundColor: "rgba(59, 130, 246, 0.55)",
        borderColor: "rgba(59, 130, 246, 1)",
        borderWidth: 0,
        fill: true,
        stack: "assets",
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: "運用益（税引後）",
        data: interest,
        backgroundColor: "rgba(34, 197, 94, 0.5)",
        borderColor: "rgba(34, 197, 94, 1)",
        borderWidth: 0,
        fill: true,
        stack: "assets",
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: "税金（含み益分）",
        data: tax,
        backgroundColor: "rgba(244, 114, 182, 0.5)",
        borderColor: "rgba(244, 114, 182, 1)",
        borderWidth: 0,
        fill: true,
        stack: "assets",
        pointRadius: 0,
        tension: 0.15,
      },
    ],
  };

  const config = {
    type: "line",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          stacked: true,
          ticks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            callback: (v: any) => `${(v as number).toLocaleString("ja-JP")}万`,
          },
          title: { display: true, text: "資産（万円, 名目）" },
        },
        x: { title: { display: true, text: params.currentAge != null ? "年齢" : "経過年数" } },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (ctx: any) => `${ctx.dataset.label}: ${formatManValue(ctx.parsed.y)}`,
          },
        },
        annotation: { annotations },
      },
    },
  };

  if (compoundChart) compoundChart.destroy();
  compoundChart = new Chart(ctx, config);
}

function renderMonteCarloChart(
  mc: ReturnType<typeof simulateMonteCarlo>,
  params: CalculateParams,
): void {
  const canvas = document.getElementById("mcChart") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const labels = mc.yearly.map((y) => (y.age != null ? `${y.age}歳` : `${y.year}年`));

  const p10 = mc.yearly.map((y) => toMan(y.p10));
  const p25 = mc.yearly.map((y) => toMan(y.p25 - y.p10));
  const p50low = mc.yearly.map((y) => toMan(y.p50 - y.p25));
  const p50high = mc.yearly.map((y) => toMan(y.p75 - y.p50));
  const p90 = mc.yearly.map((y) => toMan(y.p90 - y.p75));
  const median = mc.yearly.map((y) => toMan(y.p50));

  const data = {
    labels,
    datasets: [
      {
        label: "p10",
        data: p10,
        backgroundColor: "rgba(59, 130, 246, 0.08)",
        borderWidth: 0,
        fill: true,
        stack: "fan",
        pointRadius: 0,
      },
      {
        label: "p10〜p25",
        data: p25,
        backgroundColor: "rgba(59, 130, 246, 0.15)",
        borderWidth: 0,
        fill: true,
        stack: "fan",
        pointRadius: 0,
      },
      {
        label: "p25〜p50",
        data: p50low,
        backgroundColor: "rgba(59, 130, 246, 0.3)",
        borderWidth: 0,
        fill: true,
        stack: "fan",
        pointRadius: 0,
      },
      {
        label: "p50〜p75",
        data: p50high,
        backgroundColor: "rgba(59, 130, 246, 0.3)",
        borderWidth: 0,
        fill: true,
        stack: "fan",
        pointRadius: 0,
      },
      {
        label: "p75〜p90",
        data: p90,
        backgroundColor: "rgba(59, 130, 246, 0.15)",
        borderWidth: 0,
        fill: true,
        stack: "fan",
        pointRadius: 0,
      },
      {
        label: "中央値 (p50)",
        data: median,
        type: "line",
        borderColor: "rgba(37, 99, 235, 1)",
        backgroundColor: "transparent",
        borderWidth: 2.5,
        fill: false,
        pointRadius: 0,
        tension: 0.15,
      },
    ],
  };

  const config = {
    type: "line",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          stacked: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ticks: { callback: (v: any) => `${(v as number).toLocaleString("ja-JP")}万` },
          title: { display: true, text: "資産（万円, 実質値）" },
        },
        x: { title: { display: true, text: params.currentAge != null ? "年齢" : "経過年数" } },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (ctx: any) => `${ctx.dataset.label}: ${formatManValue(ctx.parsed.y)}`,
          },
        },
      },
    },
  };

  if (mcChart) mcChart.destroy();
  mcChart = new Chart(ctx, config);
}

function renderSummary(
  projections: YearlyProjection[],
  mc: ReturnType<typeof simulateMonteCarlo>,
  params: CalculateParams,
): void {
  const last = projections[projections.length - 1]!;
  const totalContrib =
    params.initialAmount + params.monthlyContribution * 12 * params.contributionYears;
  const totalWithdrawn = projections.reduce((s, p) => s + p.yearlyWithdrawal, 0);
  const score = computeSecurityScore({
    depletionProbability: mc.depletionProbability,
    failureProbability: mc.failureProbability,
    medianFinal: mc.finalP50,
  });
  const scoreInfo = scoreLabel(score);

  const summary = document.getElementById("summary")!;
  summary.innerHTML = `
    <div class="score-card ${scoreInfo.className}">
      <div class="score-value">${score}</div>
      <div class="score-label">${scoreInfo.label}</div>
      <div class="score-desc">安心度スコア（0–100）${helpIcon(HELP["score"]!)}</div>
    </div>
    <div class="metric-grid">
      <div class="metric"><div class="metric-label">積立元本合計${helpIcon(HELP["totalContrib"]!)}</div><div class="metric-value">${formatMan(totalContrib)}</div></div>
      <div class="metric"><div class="metric-label">最終総資産（名目）${helpIcon(HELP["finalTotal"]!)}</div><div class="metric-value">${formatMan(last.total)}</div></div>
      <div class="metric"><div class="metric-label">運用益（税引後）${helpIcon(HELP["interest"]!)}</div><div class="metric-value">${formatMan(last.interest)}</div></div>
      <div class="metric"><div class="metric-label">想定税金${helpIcon(HELP["tax"]!)}</div><div class="metric-value">${formatMan(last.tax)}</div></div>
      <div class="metric"><div class="metric-label">総引出額（名目）${helpIcon(HELP["totalWithdrawn"]!)}</div><div class="metric-value">${formatMan(totalWithdrawn)}</div></div>
      <div class="metric"><div class="metric-label">MC 中央値残高（実質）${helpIcon(HELP["mcP50"]!)}</div><div class="metric-value">${formatMan(mc.finalP50)}</div></div>
      <div class="metric"><div class="metric-label">MC 悲観値 p10（実質）${helpIcon(HELP["mcP10"]!)}</div><div class="metric-value">${formatMan(mc.finalP10)}</div></div>
      <div class="metric"><div class="metric-label">MC 楽観値 p90（実質）${helpIcon(HELP["mcP90"]!)}</div><div class="metric-value">${formatMan(mc.finalP90)}</div></div>
      <div class="metric"><div class="metric-label">枯渇確率${helpIcon(HELP["depletion"]!)}</div><div class="metric-value">${formatPercent(mc.depletionProbability)}</div></div>
      <div class="metric"><div class="metric-label">元本割れ確率${helpIcon(HELP["failure"]!)}</div><div class="metric-value">${formatPercent(mc.failureProbability)}</div></div>
    </div>
  `;
}

function getInputValue(el: HTMLInputElement): boolean | string {
  return el.type === "checkbox" ? el.checked : el.value;
}

function setInputValue(el: HTMLInputElement, value: unknown): void {
  if (el.type === "checkbox") {
    el.checked = Boolean(value);
  } else {
    el.value = String(value);
  }
}

function getInputDefault(el: HTMLInputElement | HTMLSelectElement): string {
  if (el instanceof HTMLInputElement && el.type === "checkbox") return String(el.defaultChecked);
  if (el instanceof HTMLSelectElement) {
    return (
      Array.from(el.options).find((o) => o.defaultSelected)?.value ?? el.options[0]?.value ?? ""
    );
  }
  return el.defaultValue;
}

function saveInputs(): void {
  try {
    const data: Record<string, unknown> = {};
    for (const id of PERSIST_IDS) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) continue;
      data[id] = getInputValue(el);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function loadInputs(): void {
  let data: Record<string, unknown>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!data || typeof data !== "object") return;
  for (const id of PERSIST_IDS) {
    if (!Object.prototype.hasOwnProperty.call(data, id)) continue;
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    setInputValue(el, data[id]);
  }
}

function resetInputs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  for (const id of PERSIST_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    setInputValue(el as HTMLInputElement, getInputDefault(el));
  }
}

function formatMonthlyGain(yen: number): string {
  if (!Number.isFinite(yen)) return "-";
  const sign = Math.round(toMan(yen)) > 0 ? "+" : "";
  return `${sign}${formatMan(yen)}`;
}

function renderMonthlyTable(monthly: MonthlyProjection[]): string {
  if (monthly.length === 0) return "";
  const byYear = new Map<number, MonthlyProjection[]>();
  for (const m of monthly) {
    const list = byYear.get(m.year);
    if (list) list.push(m);
    else byYear.set(m.year, [m]);
  }
  const parts: string[] = [];
  for (const [year, rows] of byYear) {
    const age = rows[0]!.age;
    const yearLabel = age != null ? `${year}年目 / ${age}歳` : `${year}年目`;
    const yearlyGain = rows.reduce((s, r) => s + r.monthlyGain, 0);
    parts.push(
      `<details class="monthly-year"><summary>${yearLabel} <span class="year-summary">年合計運用損益 ${formatMonthlyGain(yearlyGain)}</span></summary>`,
    );
    parts.push(
      `<table class="monthly-table"><thead><tr>` +
        `<th>月</th><th>リスク資産</th><th>防衛資産</th><th>合計</th>` +
        `<th>純引出</th><th>年金</th><th>他収入</th>` +
        `<th>リスク損益</th><th>防衛損益</th><th>リバランス</th>` +
        `</tr></thead><tbody>`,
    );
    for (const r of rows) {
      parts.push(
        `<tr>` +
          `<td>${r.month}月</td>` +
          `<td>${formatMan(r.riskTotal)}</td>` +
          `<td>${formatMan(r.defenseTotal)}</td>` +
          `<td>${formatMan(r.total)}</td>` +
          `<td>${formatMan(r.monthlyWithdrawal)}</td>` +
          `<td>${formatMan(r.monthlyPension)}</td>` +
          `<td>${formatMan(r.monthlyOtherIncome)}</td>` +
          `<td class="${r.monthlyGainRisk < 0 ? "neg" : ""}">${formatMonthlyGain(r.monthlyGainRisk)}</td>` +
          `<td class="${r.monthlyGainDefense < 0 ? "neg" : ""}">${formatMonthlyGain(r.monthlyGainDefense)}</td>` +
          `<td>${r.rebalanced ? "●" : ""}</td>` +
          `</tr>`,
      );
    }
    parts.push(`</tbody></table></details>`);
  }
  return parts.join("");
}

function renderMonthlyDetails(
  detMonthly: MonthlyProjection[],
  mc: ReturnType<typeof simulateMonteCarlo>,
): void {
  const host = document.getElementById("monthlyDetails");
  if (!host) return;
  const detSection = `<details class="monthly-section"><summary>決定論的（月次, 名目値）</summary>${renderMonthlyTable(detMonthly)}</details>`;
  const mcLabels: Array<[keyof typeof mc.pivotMonthlies, string]> = [
    ["p90", "モンテカルロ P90 パス（楽観側, 月次, 実質値）"],
    ["p75", "モンテカルロ P75 パス（やや楽観, 月次, 実質値）"],
    ["p50", "モンテカルロ P50 パス（中央値, 月次, 実質値）"],
    ["p25", "モンテカルロ P25 パス（やや悲観, 月次, 実質値）"],
    ["p10", "モンテカルロ P10 パス（悲観側, 月次, 実質値）"],
  ];
  const mcSections = mcLabels
    .map(([k, title]) => {
      const open = k === "p50" ? " open" : "";
      return `<details class="monthly-section"${open}><summary>${title}</summary>${renderMonthlyTable(mc.pivotMonthlies[k])}</details>`;
    })
    .join("");
  host.innerHTML = detSection + mcSections;
}

function update(): void {
  const params = readParams();
  const { yearly, monthly } = calculateCompound(params);
  const mc = simulateMonteCarlo(params);
  renderCompoundChart(yearly, params);
  renderMonteCarloChart(mc, params);
  renderSummary(yearly, mc, params);
  renderMonthlyDetails(monthly, mc);
  saveInputs();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleUpdate(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(update, 250);
}

function syncWithdrawalModeUI(): void {
  const select = document.getElementById("withdrawalMode") as HTMLSelectElement;
  const amountWrap = document.getElementById("withdrawalAmountWrap")!;
  const rateWrap = document.getElementById("withdrawalRateWrap")!;
  const inflationToggleWrap = document.getElementById("inflationAdjustedWithdrawalWrap")!;
  const mode = select.value;
  if (mode === "rate" || mode === "rate-risk") {
    amountWrap.classList.add("hidden");
    rateWrap.classList.remove("hidden");
    // 率モードはインフレ調整トグル不要
    inflationToggleWrap.classList.add("hidden");
  } else {
    amountWrap.classList.remove("hidden");
    rateWrap.classList.add("hidden");
    inflationToggleWrap.classList.remove("hidden");
  }
}

function setupWithdrawalModeToggle(): void {
  const select = document.getElementById("withdrawalMode") as HTMLSelectElement;
  select.addEventListener("change", syncWithdrawalModeUI);
  syncWithdrawalModeUI();
}

function setupResetButton(): void {
  const button = document.getElementById("resetInputs");
  if (!button) return;
  button.addEventListener("click", () => {
    resetInputs();
    syncWithdrawalModeUI();
    syncDefenseUI();
    update();
  });
}

function setupPensionPreset(): void {
  document.getElementById("pensionSingle")!.addEventListener("click", () => {
    (document.getElementById("basePension") as HTMLInputElement).value = "15";
    scheduleUpdate();
  });
  document.getElementById("pensionCouple")!.addEventListener("click", () => {
    (document.getElementById("basePension") as HTMLInputElement).value = "29";
    scheduleUpdate();
  });
  document.getElementById("pensionZero")!.addEventListener("click", () => {
    (document.getElementById("basePension") as HTMLInputElement).value = "0";
    scheduleUpdate();
  });
}

function setupProductPreset(): void {
  const select = document.getElementById("productPreset") as HTMLSelectElement;
  select.addEventListener("change", () => {
    const preset = PRESETS[select.value];
    if (!preset) return;
    (document.getElementById("annualReturnRate") as HTMLInputElement).value = String(
      preset.annualReturnRate,
    );
    (document.getElementById("expenseRatio") as HTMLInputElement).value = String(
      preset.expenseRatio,
    );
    (document.getElementById("volatility") as HTMLInputElement).value = String(preset.volatility);
    scheduleUpdate();
  });
}

function setupDefensePreset(): void {
  const select = document.getElementById("defenseProductPreset") as HTMLSelectElement | null;
  if (!select) return;
  select.addEventListener("change", () => {
    const preset = DEFENSE_PRESETS[select.value];
    if (!preset) return;
    (document.getElementById("defenseAnnualReturnRate") as HTMLInputElement).value = String(
      preset.annualReturnRate,
    );
    (document.getElementById("defenseVolatility") as HTMLInputElement).value = String(
      preset.volatility,
    );
    scheduleUpdate();
  });
}

function syncDefenseUI(): void {
  const checkbox = document.getElementById("defensePriorityOnDrawdown") as HTMLInputElement | null;
  if (!checkbox) return;
  const wraps = [
    document.getElementById("drawdownThresholdWrap"),
    document.getElementById("skipRebalanceOnDrawdownWrap"),
  ];
  for (const wrap of wraps) {
    if (!wrap) continue;
    wrap.classList.toggle("hidden", !checkbox.checked);
  }
}

function setupDefenseToggle(): void {
  const checkbox = document.getElementById("defensePriorityOnDrawdown") as HTMLInputElement | null;
  if (!checkbox) return;
  checkbox.addEventListener("change", syncDefenseUI);
  syncDefenseUI();
}

function bindInputs(): void {
  PERSIST_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", scheduleUpdate);
    el.addEventListener("change", scheduleUpdate);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupPensionPreset();
  setupProductPreset();
  setupDefensePreset();
  bindInputs();
  loadInputs();
  setupResetButton();
  setupWithdrawalModeToggle();
  setupDefenseToggle();
  update();
});
