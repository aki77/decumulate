<script setup lang="ts">
const model = defineModel<number | null>({ default: null })

const props = defineProps<{
  id?: string
  min?: number | string
  max?: number | string
  step?: number | string
  placeholder?: string
}>()

function onWheel(e: WheelEvent) {
  if (document.activeElement === e.currentTarget) {
    e.preventDefault()
  }
}

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  model.value = val === '' ? null : Number(val)
}
</script>

<template>
  <input
    :id="props.id"
    :min="props.min"
    :max="props.max"
    :step="props.step"
    :placeholder="props.placeholder"
    type="number"
    :value="model ?? ''"
    @wheel="onWheel"
    @input="onInput"
  />
</template>
