<script setup lang="ts">
import HelpIcon from "./HelpIcon.vue";
import type { ParamsState } from "../composables/useParams.ts";

const state = defineModel<ParamsState>({ required: true });
</script>

<template>
  <div class="field-group">
    <h3>
      口座構成（NISA / 特定 / 防衛）
      <HelpIcon text="NISAは非課税、特定リスクと防衛は課税（20.315%）。各口座について「時価」と「うち含み益」を入力する。元本=時価-含み益として扱う。" />
    </h3>
    <div class="field">
      <label for="initialNisa">NISA 時価（万円）</label>
      <input id="initialNisa" v-model.number="state.initialNisaMan" type="number" min="0" step="1" />
    </div>
    <div class="field">
      <label for="initialNisaGain">うちNISA 含み益（万円）</label>
      <input id="initialNisaGain" v-model.number="state.initialNisaGainMan" type="number" min="0" step="1" />
    </div>
    <div class="field">
      <label for="initialTaxableRisk">特定リスク 時価（万円）</label>
      <input id="initialTaxableRisk" v-model.number="state.initialTaxableRiskMan" type="number" min="0" step="1" />
    </div>
    <div class="field">
      <label for="initialTaxableRiskGain">うち特定リスク 含み益（万円）</label>
      <input id="initialTaxableRiskGain" v-model.number="state.initialTaxableRiskGainMan" type="number" min="0" step="1" />
    </div>
    <div class="field">
      <label for="initialDefense">防衛資産 時価（万円）</label>
      <input id="initialDefense" v-model.number="state.initialDefenseMan" type="number" min="0" step="1" />
    </div>
    <div class="field">
      <label for="initialDefenseGain">うち防衛資産 含み益（万円）</label>
      <input id="initialDefenseGain" v-model.number="state.initialDefenseGainMan" type="number" min="0" step="1" />
    </div>
    <div class="field">
      <label for="nisaInitialLifetimeUsed">
        NISA生涯枠の既使用額（万円）
        <HelpIcon text="既にNISAで買付済みの累計額（買付ベース）。生涯1800万円（夫婦モードで3600万円）から差し引く。" />
      </label>
      <input id="nisaInitialLifetimeUsed" v-model.number="state.nisaInitialLifetimeUsedMan" type="number" min="0" step="1" />
    </div>
    <div class="field checkbox-field">
      <input id="isCoupled" v-model="state.isCoupled" type="checkbox" />
      <label for="isCoupled">夫婦モード（NISA枠を2人分にする）</label>
      <HelpIcon text="年間枠 360万 → 720万、生涯枠 1800万 → 3600万 に拡張する。資産・収入・年金は1人分のままで扱う。" />
    </div>
    <div class="field checkbox-field">
      <input id="nisaTransferEnabled" v-model="state.nisaTransferEnabled" type="checkbox" />
      <label for="nisaTransferEnabled">特定口座からNISAへ振替（成長投資枠を埋める）</label>
      <HelpIcon text="毎年1月に、月次積立で消費する分を除いた残りの年枠を特定口座からの振替（売却→NISA買付）で埋める。売却時の含み益には課税される。" />
    </div>
  </div>
</template>
