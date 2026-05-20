<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import { DEFENSE_PRESETS, type ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });

const emit = defineEmits<{ applyDefensePreset: [key: string] }>();

function onPresetChange(e: Event) {
  const key = (e.target as HTMLSelectElement).value;
  state.value.defenseProductPreset = key;
  emit("applyDefensePreset", key);
}
</script>

<template>
  <div class="field-group">
    <h3>防衛資産（2バケット戦略）</h3>
    <div class="field">
      <label for="defenseProductPreset">防衛資産プリセット</label>
      <select id="defenseProductPreset" :value="state.defenseProductPreset" @change="onPresetChange">
        <option v-for="(preset, key) in DEFENSE_PRESETS" :key="key" :value="key">
          {{ key === 'custom' ? 'カスタム'
           : key === 'jgb10' ? '個人向け国債変動10年 (0.5% / 0%)'
           : '現金・普通預金 (0.1% / 0%)' }}
        </option>
      </select>
    </div>
    <div class="field">
      <label for="defenseAnnualReturnRate">
        防衛資産の想定利回り（%/年）
        <HelpIcon text="防衛資産の期待リターン。個人向け国債変動10年は 0.5% 前後、普通預金は 0.1% 前後。" />
      </label>
      <input id="defenseAnnualReturnRate" v-model.number="state.defenseAnnualReturnRate" type="number" min="0" max="10" step="0.1" />
    </div>
    <div class="field">
      <label for="defenseVolatility">
        防衛資産のボラティリティ（%/年）
        <HelpIcon text="価格変動の年率標準偏差。元本保証商品（国債・預金）なら 0% で OK。" />
      </label>
      <input id="defenseVolatility" v-model.number="state.defenseVolatility" type="number" min="0" max="20" step="0.5" />
    </div>
    <div class="field">
      <label for="targetDefenseRatioPercent">
        目標防衛割合（%）
        <HelpIcon text="資産総額（リスク＋防衛＋iDeCo）に対する防衛資産の目標比率。月末リバランスはこの比率に戻すよう動作する。0% にすると防衛バケットを使わない運用。初回起動時は初期残高から自動算出される。" />
      </label>
      <input id="targetDefenseRatioPercent" v-model.number="state.targetDefenseRatioPercent" type="number" min="0" max="100" step="1" />
    </div>
    <div class="field checkbox-field">
      <input id="defensePriorityOnDrawdown" v-model="state.defensePriorityOnDrawdown" type="checkbox" />
      <label for="defensePriorityOnDrawdown">下落時は防衛資産から優先的に取り崩す</label>
      <HelpIcon text="ON: 下落時（リスク資産の高値から閾値以上下落）は防衛資産から優先取り崩し、平時はリスク資産から優先取り崩し（防衛資産を温存／バケット戦略）。決定論的計算は下落判定を行わないため常に平時扱い＝リスク優先。OFF: 常に時価比率で両資産から按分取り崩し。" />
    </div>
    <template v-if="state.defensePriorityOnDrawdown">
      <div class="field">
        <label for="drawdownThresholdPercent">
          下落判定の閾値（%）
          <HelpIcon text="取り崩し開始後のリスク資産ピーク（高値）から、現在のリスク資産評価額が何%下落していたら「下落中」と判定するか。一般的には 10〜20%。" />
        </label>
        <input id="drawdownThresholdPercent" v-model.number="state.drawdownThresholdPercent" type="number" min="0" max="50" step="1" />
      </div>
      <div class="field checkbox-field">
        <input id="skipRebalanceOnDrawdown" v-model="state.skipRebalanceOnDrawdown" type="checkbox" />
        <label for="skipRebalanceOnDrawdown">下落判定中はリバランスを行わない</label>
        <HelpIcon text="「下落時は防衛資産から優先的に取り崩す」が ON のとき、下落判定中の月はリバランスをスキップする。OFF にすると下落中もリバランスを実行し、防衛資産を売ってリスク資産を買い戻す（逆張り的）。デフォルトは ON。" />
      </div>
    </template>
    <div class="field">
      <label for="rebalanceThresholdPoint">
        リバランス乖離閾値（pt）
        <HelpIcon text="月末の防衛資産比率が目標から何ポイント乖離したらリバランス（売買による比率調整）を行うか。例: 目標30%・閾値5pt なら 25%未満または35%超で発動。0 にすると毎月リバランス。防衛資産配分が 0% のときは無効。課税口座では売却益に課税される点に注意。" />
      </label>
      <input id="rebalanceThresholdPoint" v-model.number="state.rebalanceThresholdPoint" type="number" min="0" max="50" step="1" />
    </div>
  </div>
</template>
