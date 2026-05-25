import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeLifeEvents, sumLifeEventsAt } from "../src/life-event.ts";

const MAN = 10000;

describe("normalizeLifeEvents", () => {
  it("currentAge=40, age=50 → yearOffset=10（1-based の発火 year）", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "車買い替え", amountMan: 200, age: 50 }],
      40,
      30,
      MAN,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.yearOffset, 10);
    assert.equal(result[0]!.amount, 200 * MAN);
    assert.equal(result[0]!.label, "車買い替え");
  });

  it("範囲外（yearOffset > totalYears）は除外", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "test", amountMan: 100, age: 80 }],
      40,
      30,
      MAN,
    );
    assert.equal(result.length, 0);
  });

  it("現在以前（yearOffset < 1）は除外: age=40, currentAge=40", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "test", amountMan: 100, age: 40 }],
      40,
      30,
      MAN,
    );
    assert.equal(result.length, 0);
  });

  it("過去の年齢（yearOffset < 0）は除外", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "test", amountMan: 100, age: 30 }],
      40,
      30,
      MAN,
    );
    assert.equal(result.length, 0);
  });

  it("境界: age=currentAge+totalYears（yearOffset=totalYears）は含む", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "test", amountMan: 100, age: 70 }],
      40,
      30,
      MAN,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.yearOffset, 30);
  });

  it("amountMan=0 は除外", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "test", amountMan: 0, age: 50 }],
      40,
      30,
      MAN,
    );
    assert.equal(result.length, 0);
  });

  it("currentAge=null は age をそのまま yearOffset として使う", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "test", amountMan: 100, age: 5 }],
      null,
      30,
      MAN,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.yearOffset, 5);
  });

  it("ラベル空欄は（無題）に変換", () => {
    const result = normalizeLifeEvents(
      [{ id: "1", label: "", amountMan: 100, age: 50 }],
      40,
      30,
      MAN,
    );
    assert.equal(result[0]!.label, "（無題）");
  });
});

describe("sumLifeEventsAt", () => {
  it("該当なし → null", () => {
    const events = normalizeLifeEvents(
      [{ id: "1", label: "test", amountMan: 100, age: 50 }],
      40,
      30,
      MAN,
    );
    assert.equal(sumLifeEventsAt(events, 5), null);
  });

  it("単一イベント → 金額とラベルを返す", () => {
    const events = normalizeLifeEvents(
      [{ id: "1", label: "車買い替え", amountMan: 200, age: 50 }],
      40,
      30,
      MAN,
    );
    const result = sumLifeEventsAt(events, 10);
    assert.ok(result !== null);
    assert.equal(result.amount, 200 * MAN);
    assert.equal(result.label, "車買い替え");
  });

  it("同年複数イベントは合算・ラベル連結", () => {
    const events = normalizeLifeEvents(
      [
        { id: "1", label: "車買い替え", amountMan: 200, age: 50 },
        { id: "2", label: "旅行", amountMan: 50, age: 50 },
      ],
      40,
      30,
      MAN,
    );
    const result = sumLifeEventsAt(events, 10);
    assert.ok(result !== null);
    assert.equal(result.amount, 250 * MAN);
    assert.ok(result.label.includes("車買い替え"));
    assert.ok(result.label.includes("旅行"));
  });
});
