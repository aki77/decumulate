# CLAUDE.md

Claude Code 向けプロジェクトコンテキスト。ユーザ向け説明は [README.md](README.md) を参照。

## コマンド

```sh
pnpm test           # node:test、--experimental-strip-types で .ts を直接実行（144 件、~4秒）
pnpm check          # vue-tsc --noEmit（型チェックのみ）
pnpm build          # vite build（dist/ に成果物を出力）
pnpm dev            # vite 開発サーバ
```

Node.js 24+ 必須（`--experimental-strip-types` を素で使う）。

## 後方互換性は考慮しない

個人利用前提のプロジェクト。機能追加・改修時に既存の保存データ・API・URL パラメータの互換性を維持する必要はない:

- `localStorage` のスキーマ変更は `STORAGE_KEY` のバージョンを上げる（旧データをアプリ側で自動マイグレーションしない）
- フィールドの撤去・改名・意味変更は躊躇しない
- マイグレーション層や `if (oldFormat)` 分岐はアプリコードに書かない
- 「念のため残す」「将来の拡張に備える」コードは書かない（YAGNI）

スキーマ変更時は、ユーザが手動でマイグレーションできるよう **ブラウザコンソールで実行できる JS スニペット**を提示する。スニペットには旧キーから値を読み取り新キーで書き直す処理を含める。マイグレーションが現実的でない場合（旧フォーマットと新フォーマットで意味が大幅に変わる場合など）は「旧データを削除して再入力」で済む旨を伝えてよい。

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

## 撤去済みの旧API

以下は 3バケット化（コミット `0a7744a`）で削除済み。古い情報に基づく提案はしない:

- `initialAmount` / `defenseRatio` / `taxFree` フィールド
- `rebalanceBuckets`（→ `rebalanceTriBuckets` に置換）
- `localStorage` key `decumulate:inputs:v1`（→ `v2`、旧データは破棄）

## monte-carlo.ts のホットループ規約

`simulateMonteCarlo` の `runSimulation` は N=5000 × 12 × Y のホットループ。次のルールを破らない:

- 各バケットは `Float64Array` で保持（NISA/特定/防衛 × Total/CostBasis = 6本）
- `withdrawFromBucket` 等の純関数を呼ぶとタプル生成で遅くなるため、取り崩し・リバランス本体はインライン展開している（年初振替だけは N×Y 回なので `executeNisaTransfer` を再利用）
- `runSimulation` は phase1（null）と phase2（pivotIndices）の 2 回呼ばれ、RNG 消費順を完全一致させて同じパスを再生成する。RNG を触る順序を変えると pivot 抽出が壊れる
- シード固定（`SEED=42`）。テストは `simulateMonteCarlo` の再現性に依存する

## 入力フィールドを追加するとき

1. `src/vue/composables/useStorage.ts` の `numFields` / `boolFields` / `strFields` 配列に追加（localStorage 永続化）
2. `src/vue/composables/useParams.ts` で値を読み取り `CalculateParams`/`MonteCarloParams` に詰める
3. 既存フィールドの**意味を変える**変更なら `STORAGE_KEY` のバージョンを上げる（現在 `v3`、次は `v4`）
4. `index.html` に対応する `<input>` を追加

表示メトリクスを増やすときは `src/vue/components/ResultSummary.vue` の `HELP` 辞書にツールチップ文も追加。

## Vue レイヤー構成

`src/vue/composables/` の責務:

- **`useStorage.ts`**: `localStorage` との読み書き（`STORAGE_KEY = "decumulate:inputs:v3"`）
- **`useParams.ts`**: フォーム状態 → `CalculateParams`/`MonteCarloParams` への変換
- **`useSimulator.ts`**: `calculateCompound` / `simulateMonteCarlo` 呼び出しと結果保持
- **`useChartJs.ts`**: Chart.js インスタンス管理

計算ロジック（`src/calculate.ts` / `src/monte-carlo.ts`）は Vue に依存しない純粋関数群。テストはこの層を直接呼ぶ。

## テスト

- `node:test` + `node:assert/strict`、`--experimental-strip-types` で `.ts` を直実行
- `tests/calculate.test.ts`: 決定論版、純関数 + `calculateCompound` のスナップショット的検証
- `tests/monte-carlo.test.ts`: MC、N=5000 を毎テスト走らせるので 1 ケース ~100ms。新規テストはなるべく決定論版に寄せる
- 数値比較は `Math.abs(a - b) < ε` を使う（rounding/浮動小数の都合）

## 会話ルール

- 常に日本語で会話する（個人グローバル設定と一致）
