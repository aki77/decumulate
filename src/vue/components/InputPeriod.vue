<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import InputNumber from "./InputNumber.vue";
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>期間</h3>
    <div class="field">
      <label for="contributionYears">
        積立年数
        <HelpIcon text="月額積立を継続する年数。現在から数えてこの年数を超えると積立は止まる。切崩開始後でも、この年数以内なら積立は継続する。" />
      </label>
      <InputNumber id="contributionYears" v-model="state.contributionYears" min="0" max="70" step="1" />
    </div>
    <div class="field">
      <label for="withdrawalStartYear">
        切崩開始（現在から○年後）
        <HelpIcon text="取り崩しを開始するまでの年数。0なら来年から、5なら6年目から取り崩しが始まる。それまではリスク・防衛とも運用と積立のみ。" />
      </label>
      <InputNumber id="withdrawalStartYear" v-model="state.withdrawalStartYear" min="0" max="65" step="1" />
    </div>
    <div class="field">
      <label for="withdrawalYears">
        切崩年数
        <HelpIcon text="取り崩しを継続する年数。切崩開始からこの年数の間、毎月取り崩しを行う（リスクサイド↔防衛、NISA温存で按分）。DIE WITH ZERO モードでは「現在年齢 + 切崩開始 + 切崩年数」が想定寿命になる。" />
      </label>
      <InputNumber id="withdrawalYears" v-model="state.withdrawalYears" min="1" max="70" step="1" />
      <p v-if="state.withdrawalMode === 'zero-landing'" class="life-expectancy-hint">
        想定寿命 = {{ state.currentAge + state.withdrawalStartYear + state.withdrawalYears }} 歳
      </p>
    </div>
  </div>
</template>

<style scoped>
.life-expectancy-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--accent);
}
</style>
