import { describe, expect, it } from "vitest";
import { toPageRects } from "@/lib/annotations";

const page = { left: 100, top: 200, width: 400, height: 800 };

describe("toPageRects", () => {
  it("换算成相对页面的百分比", () => {
    const [r] = toPageRects(
      [{ left: 100, top: 200, width: 200, height: 80 }],
      page,
    );
    expect(r).toEqual({ x: 0, y: 0, w: 0.5, h: 0.1 });
  });

  it("非零偏移正确换算", () => {
    const [r] = toPageRects(
      [{ left: 300, top: 600, width: 100, height: 40 }],
      page,
    );
    expect(r.x).toBeCloseTo(0.5);
    expect(r.y).toBeCloseTo(0.5);
    expect(r.w).toBeCloseTo(0.25);
    expect(r.h).toBeCloseTo(0.05);
  });

  it("丢弃零面积矩形", () => {
    expect(
      toPageRects([{ left: 100, top: 200, width: 0, height: 10 }], page),
    ).toHaveLength(0);
  });

  it("丢弃明显跨页（y 越界）的矩形", () => {
    // top 远在页面上方 → y 为大负数，应被丢弃
    expect(
      toPageRects([{ left: 100, top: -500, width: 50, height: 20 }], page),
    ).toHaveLength(0);
  });

  it("页面零尺寸时返回空", () => {
    expect(
      toPageRects([{ left: 0, top: 0, width: 10, height: 10 }], {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      }),
    ).toHaveLength(0);
  });

  it("多个矩形（多行选区）逐个换算", () => {
    const out = toPageRects(
      [
        { left: 100, top: 200, width: 400, height: 40 },
        { left: 100, top: 240, width: 200, height: 40 },
      ],
      page,
    );
    expect(out).toHaveLength(2);
    expect(out[0].w).toBe(1);
    expect(out[1].w).toBe(0.5);
  });
});
