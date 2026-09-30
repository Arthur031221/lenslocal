import { describe, expect, it } from "vitest";
import { buildRegions, cleanLabel, mergeAdjacentRegions, quadToRect, sortReadingOrder } from "../src/merge.ts";

describe("quadToRect", () => {
  it("converts an axis-aligned quad to a bounding rect", () => {
    // Corners in order tl, tr, br, bl for a 100x50 box at (10, 20).
    const rect = quadToRect([10, 20, 110, 20, 110, 70, 10, 70]);
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("bounds a slightly rotated quad by its extremes", () => {
    const rect = quadToRect([0, 5, 100, 0, 105, 40, 5, 45]);
    expect(rect).toEqual({ x: 0, y: 0, width: 105, height: 45 });
  });

  it("rejects anything that is not exactly 8 numbers", () => {
    expect(() => quadToRect([0, 0, 1, 1])).toThrow(/8-value quad/);
  });
});

describe("cleanLabel", () => {
  it("strips stray location tokens left by a cut-off generation", () => {
    expect(cleanLabel("<loc_512>SALE<loc_87>")).toBe("SALE");
  });

  it("strips other tags and collapses whitespace", () => {
    expect(cleanLabel("  Menu   Del   Dia  ")).toBe("Menu Del Dia");
  });
});

describe("buildRegions", () => {
  it("zips labels and quad boxes and drops empty or degenerate entries", () => {
    const labels = ["OPEN", "<loc_1></loc_1>", "  ", "CLOSED"];
    const quadBoxes = [
      [0, 0, 10, 0, 10, 10, 0, 10],
      [0, 0, 10, 0, 10, 10, 0, 10],
      [0, 0, 10, 0, 10, 10, 0, 10],
      [5, 5, 5, 5, 5, 5, 5, 5], // degenerate: zero width and height
    ];
    const regions = buildRegions(labels, quadBoxes);
    expect(regions).toEqual([{ text: "OPEN", rect: { x: 0, y: 0, width: 10, height: 10 } }]);
  });

  it("stops at the shorter of the two parallel arrays", () => {
    const regions = buildRegions(["A", "B"], [[0, 0, 1, 0, 1, 1, 0, 1]]);
    expect(regions).toHaveLength(1);
  });
});

describe("sortReadingOrder", () => {
  it("orders left to right within a row, then top row before bottom row", () => {
    const regions = [
      { text: "bottom-left", rect: { x: 0, y: 100, width: 10, height: 10 } },
      { text: "top-right", rect: { x: 100, y: 0, width: 10, height: 10 } },
      { text: "top-left", rect: { x: 0, y: 0, width: 10, height: 10 } },
    ];
    const ordered = sortReadingOrder(regions).map((r) => r.text);
    expect(ordered).toEqual(["top-left", "top-right", "bottom-left"]);
  });
});

describe("mergeAdjacentRegions", () => {
  it("merges two close same-line fragments into one region with the union box", () => {
    const regions = [
      { text: "Coffee", rect: { x: 0, y: 0, width: 60, height: 20 } },
      { text: "$4", rect: { x: 70, y: 2, width: 20, height: 18 } },
    ];
    const merged = mergeAdjacentRegions(regions);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe("Coffee $4");
    expect(merged[0]!.rect).toEqual({ x: 0, y: 0, width: 90, height: 20 });
  });

  it("keeps far-apart regions on the same line separate", () => {
    const regions = [
      { text: "Left", rect: { x: 0, y: 0, width: 20, height: 20 } },
      { text: "Right", rect: { x: 500, y: 0, width: 20, height: 20 } },
    ];
    const merged = mergeAdjacentRegions(regions);
    expect(merged).toHaveLength(2);
  });

  it("keeps regions on different lines separate even when horizontally close", () => {
    const regions = [
      { text: "Line one", rect: { x: 0, y: 0, width: 40, height: 20 } },
      { text: "Line two", rect: { x: 0, y: 40, width: 40, height: 20 } },
    ];
    const merged = mergeAdjacentRegions(regions);
    expect(merged).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const regions = [{ text: "A", rect: { x: 0, y: 0, width: 10, height: 10 } }];
    const originalRect = regions[0]!.rect;
    mergeAdjacentRegions(regions);
    expect(regions[0]!.rect).toBe(originalRect);
  });
});
