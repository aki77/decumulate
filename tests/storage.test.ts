import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_VERSION,
  MIGRATIONS,
  asStoragePayload,
  migrateWith,
  parseStoredState,
  type Migration,
} from "../src/vue/composables/useStorage.ts";

const validV8Data = {
  currentAge: 50,
  initialNisaMan: 1000,
  isCoupled: true,
  productPreset: "balanced",
  otherIncomes: [
    {
      id: "a",
      label: "",
      amountMan: 10,
      amountMode: "monthly",
      startAge: null,
      endAge: null,
    },
  ],
  withdrawalLimitSteps: [
    { untilAge: 70, floorMan: 10, ceilingMan: 30 },
    { untilAge: null, floorMan: 5, ceilingMan: 20 },
  ],
};

test("asStoragePayload - 正常なエンベロープを通す", () => {
  const result = asStoragePayload({ version: 8, data: {} });
  assert.ok(result);
  assert.strictEqual(result.version, 8);
});

test("asStoragePayload - version 欠落は null", () => {
  assert.strictEqual(asStoragePayload({ data: {} }), null);
});

test("asStoragePayload - version が数値でないと null", () => {
  assert.strictEqual(asStoragePayload({ version: "8", data: {} }), null);
});

test("asStoragePayload - data 欠落は null", () => {
  assert.strictEqual(asStoragePayload({ version: 8 }), null);
});

test("asStoragePayload - 非オブジェクトは null", () => {
  assert.strictEqual(asStoragePayload(null), null);
  assert.strictEqual(asStoragePayload("string"), null);
  assert.strictEqual(asStoragePayload(42), null);
});

test("migrateWith - CURRENT_VERSION のデータはそのまま通る", () => {
  const result = migrateWith(
    { version: CURRENT_VERSION, data: validV8Data },
    MIGRATIONS,
    CURRENT_VERSION,
  );
  assert.ok(result);
  assert.strictEqual(result.currentAge, 50);
  assert.strictEqual(result.isCoupled, true);
  assert.strictEqual(result.productPreset, "balanced");
});

test("parseStoredState - 不正データは空または null を返す（壊れない）", () => {
  assert.strictEqual(parseStoredState(null), null);
  assert.strictEqual(parseStoredState("string"), null);
  const result = parseStoredState({});
  assert.ok(result);
  assert.strictEqual(Object.keys(result).length, 0);
});

test("parseStoredState - 不正な値は無視して有効な値だけ拾う", () => {
  const result = parseStoredState({
    currentAge: 50,
    initialNisaMan: "not a number",
    isCoupled: true,
    productPreset: 123,
    unknownField: "ignored",
  });
  assert.ok(result);
  assert.strictEqual(result.currentAge, 50);
  assert.strictEqual(result.initialNisaMan, undefined);
  assert.strictEqual(result.isCoupled, true);
  assert.strictEqual(result.productPreset, undefined);
});

test("migrateWith - 二段チェーン (v8→v9→v10) を適用できる", () => {
  const migrations: Migration[] = [
    {
      from: 8,
      to: 9,
      migrate: (d: any) => ({ ...d, currentAge: d.currentAge + 1 }),
    },
    {
      from: 9,
      to: 10,
      migrate: (d: any) => ({ ...d, currentAge: d.currentAge + 1 }),
    },
  ];
  const result = migrateWith({ version: 8, data: validV8Data }, migrations, 10);
  assert.ok(result);
  // 50 + 1 + 1 = 52
  assert.strictEqual(result.currentAge, 52);
});

test("migrateWith - 中間バージョンから走らせても残りのチェーンだけ適用", () => {
  const migrations: Migration[] = [
    {
      from: 8,
      to: 9,
      migrate: (d: any) => ({ ...d, currentAge: d.currentAge + 1 }),
    },
    {
      from: 9,
      to: 10,
      migrate: (d: any) => ({ ...d, currentAge: d.currentAge + 10 }),
    },
  ];
  const result = migrateWith({ version: 9, data: validV8Data }, migrations, 10);
  assert.ok(result);
  // v9→v10 のみ適用、50 + 10 = 60
  assert.strictEqual(result.currentAge, 60);
});

test("migrateWith - 不連続チェーン (8→9 が無く 9→10 のみ) は null", () => {
  const migrations: Migration[] = [
    {
      from: 9,
      to: 10,
      migrate: (d: any) => d,
    },
  ];
  const result = migrateWith({ version: 8, data: validV8Data }, migrations, 10);
  assert.strictEqual(result, null);
});

test("migrateWith - 未来バージョンは null", () => {
  const result = migrateWith({ version: 11, data: validV8Data }, [], 10);
  assert.strictEqual(result, null);
});

test("migrateWith - migrate が新フィールドを追加すると parseStoredState で拾われる", () => {
  const migrations: Migration[] = [
    {
      from: 8,
      to: 9,
      migrate: (d: any) => ({ ...d, finalTargetMan: 5000 }),
    },
  ];
  const dataWithoutFinalTarget = { ...validV8Data };
  delete (dataWithoutFinalTarget as any).finalTargetMan;
  const result = migrateWith(
    { version: 8, data: dataWithoutFinalTarget },
    migrations,
    9,
  );
  assert.ok(result);
  assert.strictEqual(result.finalTargetMan, 5000);
});

test("parseStoredState - enableJumpDiffusion: true を読み取る", () => {
  const result = parseStoredState({ ...validV8Data, enableJumpDiffusion: true });
  assert.strictEqual(result?.enableJumpDiffusion, true);
});

test("parseStoredState - enableJumpDiffusion が欠落しても他フィールドは復元される（旧データ互換）", () => {
  const dataWithout = { ...validV8Data };
  delete (dataWithout as any).enableJumpDiffusion;
  const result = parseStoredState(dataWithout);
  assert.ok(result);
  assert.strictEqual(result.enableJumpDiffusion, undefined);
});
