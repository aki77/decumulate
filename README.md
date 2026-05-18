# 資産切り崩しシミュレーター

積立 → 取り崩しの資産推移をモンテカルロ法（5,000パス）で評価する、HTML + JS 最小構成のシミュレータです。すべての計算はブラウザ内で完結し、データは外部送信されません。

参考: [asset-melt.party](https://asset-melt.party/) / [hiroppy/mf-dashboard](https://github.com/hiroppy/mf-dashboard/tree/main/apps/simulator)

## ローカルで開く

ES Modules を使っているので、`file://` ではなくローカル HTTP サーバ経由で開いてください。

```sh
python3 -m http.server 8080
# あるいは
npx serve .
```

ブラウザで `http://localhost:8080/` を開きます。

## GitHub Pages へのデプロイ

リポジトリ Settings → Pages → Build and deployment の Source を **GitHub Actions** に設定してください。`main` ブランチに push すると、`.github/workflows/deploy.yml` が自動でデプロイします。

## 機能

- 積立フェーズの月次複利計算と、取り崩しフェーズの月次計算
- 月額金額指定 / 年率（%）指定（Trinity Study）/ 年率（%）×リスク資産で毎年再評価 の 3 モード
- 取り崩し時の損益按分課税（20.315%、NISA 想定で非課税切替可）
- 公的年金（繰上げ -0.4%/月・繰下げ +0.7%/月）と他収入の控除
- インフレ率を考慮した実質値ベースのモンテカルロ（GBM, 固定 seed で再現性あり）
- p10 / p25 / p50 / p75 / p90 のファンチャート表示
- 安心度スコア（0–100）、枯渇確率、元本割れ確率の算出
- 商品プリセット（オルカン / S&P 500 / QQQ / 日経平均 / TOPIX）

## ファイル構成

```
index.html              # メインHTML、Chart.js を CDN 読み込み
styles.css              # スタイル
src/calculate.ts        # 決定論的な複利＋取り崩し計算
src/monte-carlo.ts      # モンテカルロ（Mulberry32 + Box-Muller）
src/pension.ts          # 年金繰上げ/繰下げ計算
src/main.ts             # UI 制御、Chart.js 描画
.github/workflows/deploy.yml  # GitHub Pages 自動デプロイ
```

## 注意

本ツールは投資判断や将来のリターンを保証するものではありません。あくまで参考シミュレーションです。
