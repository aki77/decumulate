// シミュレーション結果を AI エージェント相談用に Markdown 化する純関数群。

import { NISA_LIFETIME_LIMIT } from "../calculate.ts";
import type { CalculateParams } from "../calculate.ts";
import { sumLifeEventsAt } from "../life-event.ts";
import type { MonteCarloYearly, MonteCarloResult } from "../monte-carlo.ts";
import type { ParamsState, WithdrawalMode } from "./composables/useParams.ts";
import type { SimulatorResult } from "./composables/useSimulator.ts";
import { PLAN_RATING_LABELS, type Metrics } from "./composables/useMetrics.ts";
import { PRESETS, DEFENSE_PRESETS } from "./composables/useParams.ts";
import { withdrawalLabel } from "./withdrawal-label.ts";
import { MAN, formatMan, formatPercent, formatNumber } from "./format.ts";

const MODE_DESCRIPTION: Record<WithdrawalMode, string> = {
  amount: "定額取り崩し",
  rate: "リスクサイド基準で定率",
  "rate-risk": "リスクサイド時価基準で毎月再計算",
  "rate-guardrail": "ガイトン＝クリンガー（ガードレール）",
  "zero-landing": "DIE WITH ZERO（ゼロ着地）：定額取り崩しを想定寿命時の目標残高から逆算",
};

// 5年刻み + 取崩開始/終了・積立終了・iDeCo受取開始・年金開始 を抽出。
// year=0 は初期時点（運用前）なので含めない。1年目から始め、最終年も含む。
export function pickYearlyMilestones(
  yearly: MonteCarloYearly[],
  state: ParamsState,
  params: CalculateParams,
): MonteCarloYearly[] {
  if (yearly.length === 0) return [];
  const byYear = new Map<number, MonteCarloYearly>();
  for (const row of yearly) byYear.set(row.year, row);

  const set = new Set<number>();
  const maxYear = yearly[yearly.length - 1]!.year;
  if (byYear.has(1)) set.add(1);
  set.add(maxYear);

  for (let y = 5; y <= maxYear; y += 5) {
    if (byYear.has(y)) set.add(y);
  }

  if (byYear.has(params.contributionYears)) set.add(params.contributionYears);
  if (byYear.has(params.withdrawalStartYear)) set.add(params.withdrawalStartYear);
  const withdrawalEnd = params.withdrawalStartYear + params.withdrawalYears - 1;
  if (byYear.has(withdrawalEnd)) set.add(withdrawalEnd);

  if (state.idecoEnabled) {
    const idecoReceiveYear = state.idecoReceiveStartAge - state.currentAge + 1;
    if (byYear.has(idecoReceiveYear)) set.add(idecoReceiveYear);
  }
  if (state.basePensionMan > 0) {
    const pensionYear = state.pensionStartAge - state.currentAge + 1;
    if (byYear.has(pensionYear)) set.add(pensionYear);
  }

  return Array.from(set)
    .sort((a, b) => a - b)
    .map((y) => byYear.get(y)!);
}

function fmtMan(yen: number): string {
  // formatMan の "万円" を含まない短縮版（表内・サマリで単位を別途明示するため）
  if (!Number.isFinite(yen)) return "-";
  return `${Math.round(yen / MAN).toLocaleString("ja-JP")}万`;
}

function presetLabel(key: string): string {
  return key === "custom" ? "カスタム" : PRESETS[key]?.label ?? key;
}

function defensePresetLabel(key: string): string {
  return key === "custom" ? "カスタム" : DEFENSE_PRESETS[key]?.label ?? key;
}

function sectionHeader(state: ParamsState): string {
  const idecoLine = state.idecoEnabled
    ? "- **iDeCo**: 別管理。受取開始まで取り崩し不可。一時金は退職所得控除、年金は公的年金等控除（公的年金と合算）。"
    : "- iDeCo: 今回のシミュレーションでは無効。";
  return [
    "# 資産形成・取り崩しシミュレーション結果",
    "",
    "このシミュレーションは以下の口座区分で月次計算しています:",
    "",
    "- **NISA**: 非課税口座のリスク資産（株式等）。取り崩し時非課税。",
    "- **特定リスク**: 課税口座のリスク資産（株式等）。含み益按分で 20.315% 課税。",
    "- **防衛**: 低リスク資産（現預金・国債等）。リスクサイドの暴落時クッション。",
    idecoLine,
    "",
    "リスクサイド（NISA + 特定リスク）と防衛サイドは別の利回り・ボラで運用し、リバランス・取り崩しは月次で実行。モンテカルロは N=5000 試行・実質値（インフレ控除後）。",
  ].join("\n");
}

function sectionInputBasic(state: ParamsState): string {
  const ageNow = state.currentAge;
  return [
    "## 入力条件",
    "",
    "### 基本",
    `- 現在年齢: ${ageNow} 歳 / 夫婦モード: ${state.isCoupled ? "ON" : "OFF"}`,
    `- 積立期間: ${state.contributionYears} 年 / 月額: ${state.monthlyContributionMan} 万円`,
    `- 取り崩し: 開始 ${state.withdrawalStartYear} 年目（${ageNow + state.withdrawalStartYear} 歳） / 期間 ${state.withdrawalYears} 年`,
    `- 取り崩しモード: ${withdrawalLabel(state)}（${MODE_DESCRIPTION[state.withdrawalMode]}）`,
    `- インフレ率: ${formatNumber(state.inflationRate)}% / 実質取崩: ${state.inflationAdjustedWithdrawal ? "ON" : "OFF"}`,
    "",
    "### 利回り・ボラティリティ",
    `- リスク資産: 年率 ${formatNumber(state.annualReturnRate)}%（名目） / σ ${formatNumber(state.volatility)}% / 経費率 ${formatNumber(state.expenseRatio, 3)}%（プリセット: ${presetLabel(state.productPreset)}）${state.enableJumpDiffusion ? "／JDジャンプ有効" : ""}`,
    `- 防衛資産: 年率 ${formatNumber(state.defenseAnnualReturnRate)}%（名目） / σ ${formatNumber(state.defenseVolatility)}%（プリセット: ${defensePresetLabel(state.defenseProductPreset)}）`,
  ].join("\n");
}

function sectionInitialAssets(state: ParamsState): string {
  const lines: string[] = [
    "### 初期資産（口座別, 万円）",
    "",
    "| 口座 | 時価 | 含み益 |",
    "| --- | ---: | ---: |",
    `| NISA | ${state.initialNisaMan.toLocaleString("ja-JP")} | ${state.initialNisaGainMan.toLocaleString("ja-JP")} |`,
    `| 特定リスク | ${state.initialTaxableRiskMan.toLocaleString("ja-JP")} | ${state.initialTaxableRiskGainMan.toLocaleString("ja-JP")} |`,
    `| 防衛 | ${state.initialDefenseMan.toLocaleString("ja-JP")} | ${state.initialDefenseGainMan.toLocaleString("ja-JP")} |`,
  ];
  if (state.idecoEnabled) {
    lines.push(`| iDeCo | ${state.initialIdecoMan.toLocaleString("ja-JP")} | ${state.initialIdecoGainMan.toLocaleString("ja-JP")} |`);
  }
  const lifetimeLimitMan = (state.isCoupled ? NISA_LIFETIME_LIMIT * 2 : NISA_LIFETIME_LIMIT) / MAN;
  lines.push(
    "",
    `- NISA 生涯枠 使用済: ${state.nisaInitialLifetimeUsedMan.toLocaleString("ja-JP")} 万円（${state.isCoupled ? "夫婦枠" : "個人枠"} ${lifetimeLimitMan.toLocaleString("ja-JP")} 万のうち）`,
  );
  return lines.join("\n");
}

function sectionIdeco(state: ParamsState): string {
  if (!state.idecoEnabled) {
    return "### iDeCo\n\n- なし（無効）";
  }
  return [
    "### iDeCo",
    `- 拠出: 月 ${state.idecoMonthlyContributionMan} 万 / 残り ${state.idecoContributionYears} 年`,
    `- 受取開始: ${state.idecoReceiveStartAge} 歳 / 一時金比率 ${state.idecoLumpSumRatio}% / 年金期間 ${state.idecoPensionYears} 年`,
  ].join("\n");
}

function sectionPensionAndOtherIncome(state: ParamsState): string {
  const lines: string[] = ["### 公的年金・その他収入"];
  lines.push(
    state.basePensionMan > 0
      ? `- 公的年金: ${state.pensionStartAge} 歳〜 月 ${state.basePensionMan} 万円`
      : "- 公的年金: なし",
  );
  if (state.otherIncomes.length === 0) {
    lines.push("- その他収入: なし");
  } else {
    for (const e of state.otherIncomes) {
      const label = e.label || "（無題）";
      const start = e.startAge != null ? `${e.startAge}歳〜` : "現在〜";
      const end = e.endAge != null ? `${e.endAge}歳まで` : "終身";
      const unit = e.amountMode === "annual" ? "年" : "月";
      lines.push(`- その他収入: ${label} / ${unit} ${e.amountMan} 万 / ${start} ${end}`);
    }
  }
  return lines.join("\n");
}

function sectionLifeEvents(state: ParamsState): string {
  const lines: string[] = ["### ライフイベント支出（一時出費）"];
  if (state.lifeEvents.length === 0) {
    lines.push("- なし");
  } else {
    lines.push("（金額は実質値、その年の1月に一括計上）");
    lines.push("");
    lines.push("| 年齢 | ラベル | 金額 |");
    lines.push("| ---: | --- | ---: |");
    const sorted = [...state.lifeEvents].sort((a, b) => a.age - b.age);
    for (const e of sorted) {
      const label = e.label || "（無題）";
      lines.push(`| ${e.age}歳 | ${label} | ${e.amountMan.toLocaleString("ja-JP")}万 |`);
    }
    const totalMan = state.lifeEvents.reduce((s, e) => s + e.amountMan, 0);
    lines.push("");
    lines.push(`- **支出累計**: ${totalMan.toLocaleString("ja-JP")} 万円（実質値）`);
  }
  return lines.join("\n");
}

function sectionWithdrawalConstraints(state: ParamsState): string {
  const lines: string[] = ["### 取り崩し制約"];
  if (state.withdrawalMode === "zero-landing") {
    lines.push(
      `- DIE WITH ZERO ソルバー: 想定寿命時残高目標 ${state.finalTargetMan} 万（実質値） / Slow-Go 開始 ${state.slowGoStartAge} 歳 / No-Go 開始 ${state.noGoStartAge} 歳 / Slow-Go 係数 ${state.slowGoCoefPercent}% / No-Go 床 ${state.minMonthlyWithdrawalMan} 万`,
    );
    lines.push(
      `- 動的取り崩し: 毎年「Go-Go月額 × (現リスクサイド ÷ 取り崩し開始時リスクサイド)」を base として再計算し、Slow-Go 期は × Slow-Go 係数、No-Go 期は最低月額（固定）を適用した後、下限・上限でクランプ`,
    );
  }
  // floor/ceiling が一度も指定されていないなら省略。0 と null は同じ意味として扱う（未入力）。
  const hasAnyLimit = state.withdrawalLimitSteps.some(
    (s) => (s.floorMan != null && s.floorMan !== 0) || (s.ceilingMan != null && s.ceilingMan !== 0),
  );
  if (!hasAnyLimit) {
    lines.push("- 年齢別 floor/ceiling: なし");
  } else {
    lines.push("- 年齢別 floor/ceiling（万円・実質値）:");
    for (const s of state.withdrawalLimitSteps) {
      const range = s.untilAge != null ? `〜${s.untilAge}歳` : "以降";
      const floor = s.floorMan != null ? `${s.floorMan}` : "—";
      const ceiling = s.ceilingMan != null ? `${s.ceilingMan}` : "—";
      lines.push(`  - ${range}: floor ${floor} / ceiling ${ceiling}`);
    }
  }
  if (state.withdrawalMode === "rate-guardrail") {
    lines.push(
      `- ガードレール: 上 +${state.guardrailUpperPercent}% / 下 -${state.guardrailLowerPercent}% で ±${state.guardrailAdjustmentPercent}% 調整`,
    );
  }
  return lines.join("\n");
}

function sectionRebalance(state: ParamsState): string {
  return [
    "### リバランス・グライドパス",
    `- 防衛比率: 開始 ${state.targetDefenseRatioStartPercent}% → 終了 ${state.targetDefenseRatioEndPercent}%（${state.glidePathEndAge} 歳まで）`,
    `- ドローダウン閾値: -${state.drawdownThresholdPercent}% / 取崩時の防衛優先: ${state.defensePriorityOnDrawdown ? "ON" : "OFF"} / DD時リバランス停止: ${state.skipRebalanceOnDrawdown ? "ON" : "OFF"}`,
    `- リバランス閾値: ±${state.rebalanceThresholdPoint} ポイント / NISA振替: ${state.nisaTransferEnabled ? "ON" : "OFF"}`,
  ].join("\n");
}

function sectionDeterministicMetrics(metrics: Metrics): string {
  return [
    "### 決定論シナリオ（名目, 年率固定）",
    `- 最終総資産: ${formatMan(metrics.last.total)}`,
    `- 運用益（税引後）: ${formatMan(metrics.last.interest)}`,
    `- 総引出額: ${formatMan(metrics.totalWithdrawn)}`,
    `- 積立元本合計: ${formatMan(metrics.totalContrib)}`,
  ].join("\n");
}

function sectionMonteCarloMetrics(mc: MonteCarloResult): string {
  const lines: string[] = [
    "### モンテカルロ（実質, N=5000）",
    `- 最終 P10 / P50 / P90: ${formatMan(mc.finalP10)} / ${formatMan(mc.finalP50)} / ${formatMan(mc.finalP90)}`,
    `- 枯渇確率: ${formatPercent(mc.depletionProbability)}`,
    `- 元本割れ確率: ${formatPercent(mc.failureProbability)}`,
    `- 最大DD P10 / P50 / P90: ${formatPercent(mc.maxDrawdownP10)} / ${formatPercent(mc.maxDrawdownP50)} / ${formatPercent(mc.maxDrawdownP90)}`,
  ];
  if (mc.sequenceP10Diagnostics) {
    const d = mc.sequenceP10Diagnostics;
    lines.push(`- シーケンスリスク p10 5年後資産比率: ${formatPercent(d.totalAtSeqWindowEnd / d.baseTotalAtWithdrawalStart)}`);
  }
  return lines.join("\n");
}

// DIE WITH ZERO モードのみ出力。プラン評価（FP 実務基準）の根拠を AI に渡す。
function sectionPlanRating(metrics: Metrics, state: ParamsState): string | null {
  if (state.withdrawalMode !== "zero-landing") return null;
  const lines: string[] = ["### DIE WITH ZERO プラン評価"];
  lines.push(
    `- 想定寿命（${metrics.lifeExpectancyAge} 歳）時残高 p50（実質）: ${formatMan(metrics.finalTotalAtLifeExpectancy)}`,
  );
  lines.push(
    `- 目標残高との差分: ${(metrics.finalDelta >= 0 ? "+" : "") + formatMan(metrics.finalDelta)}`,
  );
  if (metrics.finalAchievementProbability != null) {
    lines.push(`- 目標達成確率: ${formatPercent(metrics.finalAchievementProbability)}`);
  }
  lines.push(`- プラン評価: ${PLAN_RATING_LABELS[metrics.planRating]}`);
  lines.push(
    "- 評価基準: 目標達成確率（MC 5000 試行のうち最終残高が目標以上で終わった割合）で 95%↑「保守的」/ 80〜95%「現実的（Kitces 等の FP 実務目安）」/ 50〜80%「ギリギリ」/ 50%↓「リスク高」",
  );
  return lines.join("\n");
}

function sectionNisaIdecoMetrics(metrics: Metrics, state: ParamsState): string {
  const lines: string[] = [
    "### NISA / iDeCo",
    `- 最終 NISA 残高: ${formatMan(metrics.last.nisaTotal)}`,
    `- NISA 生涯枠使用率: ${formatPercent(metrics.nisaLifetimeUsageRatio)}`,
  ];
  if (state.idecoEnabled) {
    lines.push(`- iDeCo 一時金累計（税引後）: ${formatMan(metrics.totalIdecoLumpSum)}`);
    lines.push(`- iDeCo 年金累計（税引後）: ${formatMan(metrics.totalIdecoPension)}`);
  }
  return lines.join("\n");
}

function noteFor(year: number, state: ParamsState, params: CalculateParams): string {
  const notes: string[] = [];
  if (year === params.contributionYears) notes.push("積立終了");
  if (year === params.withdrawalStartYear) notes.push("取り崩し開始");
  if (year === params.withdrawalStartYear + params.withdrawalYears - 1) notes.push("取り崩し終了");
  if (state.idecoEnabled && year === state.idecoReceiveStartAge - state.currentAge + 1) {
    notes.push("iDeCo受給開始");
  }
  if (state.basePensionMan > 0 && year === state.pensionStartAge - state.currentAge + 1) {
    notes.push("公的年金開始");
  }
  const leAtYear = sumLifeEventsAt(params.lifeEvents, year);
  if (leAtYear !== null) {
    notes.push(`ライフイベント: ${leAtYear.label}（${Math.round(leAtYear.amount / MAN)}万）`);
  }
  return notes.join("・");
}

function sectionYearlyTable(
  yearly: MonteCarloYearly[],
  state: ParamsState,
  params: CalculateParams,
): string {
  const picked = pickYearlyMilestones(yearly, state, params);
  const lines: string[] = [
    "## モンテカルロ 年次推移（実質, 5年刻み・節目）",
    "",
    "N=5000 試行のうちの分位点。実質値（インフレ控除後, 万円）。",
    "",
    "| 年 | 年齢 | P10 | P50 | 枯渇率 | 備考 |",
    "| ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const row of picked) {
    lines.push(
      `| ${row.year} | ${row.age} | ${fmtMan(row.p10)} | ${fmtMan(row.p50)} | ${formatPercent(row.depletionRate)} | ${noteFor(row.year, state, params)} |`,
    );
  }
  lines.push(
    "",
    "- P10 = 下位 10% タイル（下振れシナリオの目安）",
    "- P50 = 中央値",
    "- 枯渇率 = その年時点で資産がゼロになっている試行の割合（累積）",
  );
  return lines.join("\n");
}

function sectionGlossary(state: ParamsState): string {
  const lines: string[] = [
    "## メトリクス用語の説明",
    "",
    "- **名目 / 実質**: 名目=インフレ控除前の額面、実質=インフレ控除後の購買力ベース。入力の「年率」「σ」は名目、「インフレ率」は独立入力。決定論シナリオは名目のまま出力、モンテカルロは `monthlyDrift = (μ - インフレ率 - σ²/2) / 12` で実質化し出力も実質値（各メトリクス末尾の単位注記を参照）。",
    "- **積立元本合計**: 初期投資額 + 月額積立 × 12 × 積立年数。",
    "- **運用益（税引後）**: 最終時点の元本超過分。課税口座は税引後。",
    "- **MC P10 / P50 / P90**: モンテカルロ 5,000 試行の最終資産分布の下位10% / 中央値 / 上位10%。インフレ控除後の実質値。",
    "- **枯渇確率**: 取り崩し期間中に資産がゼロになる試行の割合。",
    "- **元本割れ確率**: 最終資産が積立元本合計を下回る試行の割合。",
    "- **最大DD P50**: 取り崩し開始月以降の総資産（実質）のピークからの最大下落率の中央値。bond tent 戦略・心理的耐性の判断材料。",
    "- **シーケンスp10 5年後資産比率**: 取崩開始5年の累積実質リターン下位10%パスでの、5年後資産 / 開始時資産。100%未満なら序盤に目減り。",
    "- **NISA 生涯枠使用率**: NISA生涯枠（個人 1800万 / 夫婦 3600万）のうち買付額ベースで何%使ったか。",
  ];
  if (state.idecoEnabled) {
    lines.push(
      "- **iDeCo 一時金累計**: 受取開始月の一時金税引後合計。退職所得控除は iDeCo 拠出年数で計算（退職金との通算ルールはモデル化していないので、退職金別途受給の会社員は実税額が増える可能性）。",
      "- **iDeCo 年金累計**: iDeCo年金受取の税引後累計。公的年金等控除は公的年金と合算枠で計算（2025年改正後の速算表）。",
    );
  }
  if (state.lifeEvents.length > 0) {
    lines.push(
      "- **ライフイベント支出**: 実質値で入力し、その年の1月に一括計上。通常の取り崩しに加算され、3バケット分配・NISA温存ルール・防衛優先フラグが適用される。",
    );
  }
  return lines.join("\n");
}

function sectionFootnotes(): string {
  return [
    "## 前提・注意",
    "",
    "- 計算はブラウザ内で完結（外部送信なし）",
    "- 退職金との受給間隔ルール（2026年1月施行で iDeCo 先行 5→10年、退職金先行は19年ルール）は厳密にモデル化していない",
    "- 税制は 2025年改正後の速算表ベース",
    "- リスク/防衛資産の「年率」は**名目値**として入力する規約。モンテカルロ側で別途インフレ率を控除して実質化しているため、入力の名目年率を単独で「楽観/保守」と判定しないこと（例: 名目6% + インフレ2% ≒ 実質4%）",
    "- 過去の市場データやリスクを保証するものではない",
  ].join("\n");
}

export function buildMarkdownReport(
  state: ParamsState,
  params: CalculateParams,
  result: SimulatorResult,
  metrics: Metrics,
): string {
  const parts = [
    sectionHeader(state),
    sectionInputBasic(state),
    sectionInitialAssets(state),
    sectionIdeco(state),
    sectionPensionAndOtherIncome(state),
    sectionLifeEvents(state),
    sectionWithdrawalConstraints(state),
    sectionRebalance(state),
    "## 主要メトリクス",
    sectionDeterministicMetrics(metrics),
    sectionMonteCarloMetrics(result.mc),
    sectionPlanRating(metrics, state),
    sectionNisaIdecoMetrics(metrics, state),
    sectionYearlyTable(result.mc.yearly, state, params),
    sectionGlossary(state),
    sectionFootnotes(),
  ];
  return parts.filter((s): s is string => s != null).join("\n\n") + "\n";
}
