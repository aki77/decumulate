# CLAUDE.md

Claude Code 向けプロジェクトコンテキスト。ユーザ向け説明は [README.md](README.md) を参照。

## コマンド

```sh
pnpm test           # node:test、--experimental-strip-types で .ts を直接実行（249 件、~17秒）
pnpm check          # vue-tsc --noEmit（型チェックのみ）
pnpm build          # vite build（dist/ に成果物を出力）
pnpm dev            # vite 開発サーバ
```

Node.js 24+ 必須（`--experimental-strip-types` を素で使う）。

## 保存データのマイグレーション

`localStorage` と JSON エクスポートのスキーマは、ペイロード内の `version` フィールドで自動マイグレーションする:

- `localStorage` キーは `decumulate:inputs`（バージョン無し固定）
- ペイロードは `{ version: number, data: ParamsState }`。JSON エクスポート/インポートも同形式
- スキーマ変更時は `src/vue/composables/useStorage.ts` の `CURRENT_VERSION` を +1 し、`MIGRATIONS` 配列に `{ from, to: from+1, migrate }` を 1 件追加する
- 線形連鎖（`from` → `from+1`）のみ。ギャップ禁止。フィールド改名・撤去は `migrate` 関数内で行う（YAGNI: 旧フィールドを残さない）
- 未来バージョンのデータ・`version` 欠落データは無視してデフォルト起動（fail-soft）

[tmp/migration.txt](tmp/migration.txt) には v7 以前から v8 への手動マイグレーションスニペットが残る（v8 未満のユーザが DevConsole で実行するため）。v8 への自動取り込みは初回起動時にアプリ側で実行される。

## コアモデル: 3バケット

資産は常に **NISA / 特定リスク / 防衛** の 3 バケットで保持する:

- **NISA**（リスク側、非課税）: `taxRate=0` で取り崩し
- **特定リスク**（リスク側、課税）: `TAX_RATE=0.20315`、含み益按分課税
- **防衛**（課税、低リスク商品）: 別利回り、別ボラ

「リスクサイド」= NISA + 特定リスク の合算。リバランス・年率モードの基準額・取り崩しの最初の按分はリスクサイド単位で行い、その後 `splitRiskSide` で **特定 → NISA の順**（NISA温存）に分解する。

NISA枠は `nisaInitialLifetimeUsed`（生涯使用済額, 円）+ 年初リセットの `yearlyNisaUsed` で管理。`isCoupled=true` で年枠 720万 / 生涯枠 3600万 に拡張（夫婦モード）。

## 月次ループの処理順序（厳守）

`src/calculate.ts` / `src/monte-carlo.ts` で共通:

1. **年初一括NISA振替**（1月のみ、ホットループ外）: `executeNisaTransfer` で特定→NISA。月次積立年間総額を年枠から先取りした残りを充当
2. 月次運用（リスク利回り / 防衛利回り）
3. 積立（NISA枠優先 → 余りは特定リスク）
4. 取り崩し（リスクサイド vs 防衛 → リスクサイド内で 特定 → NISA）
5. リバランス（`rebalanceTriBuckets`: 売却は特定優先、買付はNISA枠優先）

順序を入れ替えると枠消費と課税が壊れる。テストで担保されているので変更時は `npm test` で検証する。

## 単位（名目 vs 実質）

- `src/calculate.ts` は **名目値**で計算（インフレ調整なし、表側「決定論的グラフ / 月次テーブル」用）
- `src/monte-carlo.ts` は **実質値**で計算（GBMドリフトから `ri` を引く、表側「MCグラフ / p10〜p90 月次テーブル」用）

同じ params でも両者の出力は単位が違う。混同して比較しない。

`src/zero-landing.ts` のソルバーは **MC の p50 経路（実質値）** で Go-Go 月額を逆算する。決定論版だと無分散シナリオ 1 本のため約 50% 確率で枯渇する月額を推奨してしまうため。`finalTarget` は実質値として解釈され、`MetricsDetail` の「想定寿命時残高」表示も同じ p50（実質値）を参照する。

## 撤去済みの旧API

以下は 3バケット化（コミット `0a7744a`）で削除済み。古い情報に基づく提案はしない:

- `initialAmount` / `defenseRatio` / `taxFree` フィールド
- `rebalanceBuckets`（→ `rebalanceTriBuckets` に置換）
- `localStorage` key `decumulate:inputs:vN`（→ `decumulate:inputs` + ペイロードに `version`。v8 以前のキーは自動マイグ対象外）

## monte-carlo.ts のホットループ規約

`simulateMonteCarlo` の `runSimulation` は N=5000 × 12 × Y のホットループ。次のルールを破らない:

- 各バケットは `Float64Array` で保持（NISA/特定/防衛 × Total/CostBasis = 6本）
- `withdrawFromBucket` 等の純関数を呼ぶとタプル生成で遅くなるため、取り崩し・リバランス本体はインライン展開している（年初振替だけは N×Y 回なので `executeNisaTransfer` を再利用）
- `runSimulation` は phase1（null）と phase2（pivotIndices）の 2 回呼ばれ、RNG 消費順を完全一致させて同じパスを再生成する。RNG を触る順序を変えると pivot 抽出が壊れる
- シードは `simulateMonteCarlo(params, seed?)` の第2引数で受け取り、省略時は `Math.random()` から生成（毎回非決定的）。テストは `SEED` 定数（=42）を明示渡しして再現性を担保する
- 戻り値 `MonteCarloResult.seed` に実使用シードを含む。デバッグJSONはこの値を出力する
- `runSimulation` の phase1/phase2 は同一 seed の `mulberry32(seed)` を 2 回生成して RNG 消費順を一致させる（既存構造を維持）

## 入力フィールドを追加するとき

1. `src/vue/composables/useStorage.ts` の `numFields` / `boolFields` / `strFields` 配列に追加（localStorage 永続化）
2. `src/vue/composables/useParams.ts` で値を読み取り `CalculateParams`/`MonteCarloParams` に詰める
3. 既存フィールドの**意味を変える**（撤去・改名・型変換）場合は `CURRENT_VERSION` を +1 して `MIGRATIONS` に `{ from: 旧, to: 新, migrate: (data) => {...} }` を追加。`tests/storage.test.ts` で挙動を検証
4. `index.html` に対応する `<input>` を追加

表示メトリクスを増やすときは `src/vue/components/ResultSummary.vue` の `HELP` 辞書にツールチップ文も追加。

## Vue レイヤー構成

`src/vue/composables/` の責務:

- **`useStorage.ts`**: `localStorage` との読み書き（`STORAGE_KEY = "decumulate:inputs"`、ペイロードに `version` を持つエンベロープ形式）+ マイグレーション基盤（`CURRENT_VERSION` / `MIGRATIONS`）
- **`useParams.ts`**: フォーム状態 → `CalculateParams`/`MonteCarloParams` への変換
- **`useSimulator.ts`**: `calculateCompound` / `simulateMonteCarlo` 呼び出しと結果保持
- **`useChartJs.ts`**: Chart.js インスタンス管理

計算ロジック（`src/calculate.ts` / `src/monte-carlo.ts`）は Vue に依存しない純粋関数群。テストはこの層を直接呼ぶ。

## 取り崩し下限（withdrawalLimitSteps）の動作

- 下限は `baseWithdrawal`（年金・副収入差し引き**前**）にクランプされる
- `netWithdrawal = max(baseWithdrawal - income, 0)` の順序
- 例: 下限30万・副収入15万 → 資産取り崩し15万・生活費合計30万
- `rate-risk` / `rate-guardrail` モードで `fixedMonthlyWithdrawalMan` は**無視**される。下限は必ず `withdrawalLimitSteps` で設定すること

## テスト

- `node:test` + `node:assert/strict`、`--experimental-strip-types` で `.ts` を直実行
- `tests/calculate.test.ts`: 決定論版、純関数 + `calculateCompound` のスナップショット的検証
- `tests/monte-carlo.test.ts`: MC、N=5000 を毎テスト走らせるので 1 ケース ~100ms。新規テストはなるべく決定論版に寄せる
- `tests/storage.test.ts`: マイグレーション基盤（`migrateWith` / `asStoragePayload` / `parseStoredState`）の純関数テスト
- 数値比較は `Math.abs(a - b) < ε` を使う（rounding/浮動小数の都合）

## 会話ルール

- 常に日本語で会話する（個人グローバル設定と一致）
