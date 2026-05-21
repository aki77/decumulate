<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import InputNumber from "./InputNumber.vue";
import { PRESETS, type ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });

const emit = defineEmits<{ applyProductPreset: [key: string] }>();

function onPresetChange(e: Event) {
  const key = (e.target as HTMLSelectElement).value;
  state.value.productPreset = key;
  emit("applyProductPreset", key);
}
</script>

<template>
  <div class="field-group">
    <h3>運用</h3>
    <div class="field field--full">
      <label for="productPreset">商品プリセット</label>
      <select id="productPreset" :value="state.productPreset" @change="onPresetChange">
        <option v-for="(preset, key) in PRESETS" :key="key" :value="key">
          {{ key === 'custom' ? 'カスタム'
           : key === 'allcountry' ? 'オルカン (7.5% / 0.058%)'
           : key === 'sp500' ? 'S&P 500 (10% / 0.08%)'
           : key === 'qqq' ? 'QQQ (12% / 0.20%)'
           : key === 'nikkei' ? '日経平均 (7.5% / 0.14%)'
           : 'TOPIX (6% / 0.14%)' }}
        </option>
      </select>
    </div>
    <div class="field">
      <label for="annualReturnRate">
        想定利回り（%/年）
        <HelpIcon text="年あたりの期待リターン。インデックス投信なら過去実績ベースで 5〜10% 程度が目安。" />
      </label>
      <InputNumber id="annualReturnRate" v-model="state.annualReturnRate" min="0" max="15" step="0.1" />
    </div>
    <div class="field">
      <label for="expenseRatio">
        信託報酬（%/年）
        <HelpIcon text="投資信託を保有している間、毎年資産から差し引かれる運用コスト。" />
      </label>
      <InputNumber id="expenseRatio" v-model="state.expenseRatio" min="0" max="3" step="0.01" />
    </div>
    <div class="field">
      <label for="volatility">
        ボラティリティ（%/年）
        <HelpIcon text="リターンのブレ幅（年率標準偏差）。値が大きいほど短期の値動きが激しく、モンテカルロのバラツキが大きくなる。" />
      </label>
      <InputNumber id="volatility" v-model="state.volatility" min="5" max="30" step="1" />
    </div>
    <div class="field">
      <label for="inflationRate">
        インフレ率（%/年）
        <HelpIcon text="物価上昇率。実質値（購買力）を計算する際に名目値から差し引く。" />
      </label>
      <InputNumber id="inflationRate" v-model="state.inflationRate" min="0" max="10" step="0.1" />
    </div>
  </div>
</template>
