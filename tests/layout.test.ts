import { describe, expect, it } from "vitest";
import { clampFontSize, fitContain, rectToOverlayBox, scaleRectToDisplay } from "../src/layout.ts";

describe("scaleRectToDisplay", () => {
  it("scales a rect by the ratio of displayed to natural size", () => {
    // Natural 1000x2000 shown at 500x1000 is a uniform 0.5 scale on both axes.
    const box = scaleRectToDisplay(
      { x: 100, y: 200, width: 300, height: 100 },
      { width: 1000, height: 2000 },
      { width: 500, height: 1000 },
    );
    expect(box.left).toBe(50);
    expect(box.top).toBe(100);
    expect(box.width).toBe(150);
    expect(box.height).toBe(50);
  });

  it("handles independent x and y scale factors", () => {
    const box = scaleRectToDisplay(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 200, height: 50 },
    );
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBe(200);
    expect(box.height).toBe(50);
  });

  it("throws on a non-positive natural size", () => {
    expect(() =>
      scaleRectToDisplay({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 100 }, { width: 10, height: 10 }),
    ).toThrow();
  });
});

describe("clampFontSize", () => {
  it("targets 70 percent of the box height", () => {
    expect(clampFontSize(20)).toBe(14);
  });

  it("floors tiny boxes at the minimum readable size", () => {
    expect(clampFontSize(2)).toBe(10);
  });

  it("caps huge boxes at the maximum size", () => {
    expect(clampFontSize(1000)).toBe(28);
  });
});

describe("fitContain", () => {
  it("letterboxes top and bottom when the image is relatively wider than the container", () => {
    // 2:1 image in a 1:1 container: full width, half height, centered vertically.
    const fit = fitContain({ width: 200, height: 100 }, { width: 100, height: 100 });
    expect(fit.renderedSize).toEqual({ width: 100, height: 50 });
    expect(fit.offset).toEqual({ x: 0, y: 25 });
  });

  it("letterboxes left and right when the image is relatively taller than the container", () => {
    // 1:2 image in a 1:1 container: full height, half width, centered horizontally.
    const fit = fitContain({ width: 100, height: 200 }, { width: 100, height: 100 });
    expect(fit.renderedSize).toEqual({ width: 50, height: 100 });
    expect(fit.offset).toEqual({ x: 25, y: 0 });
  });

  it("returns a zero box for degenerate input instead of dividing by zero", () => {
    const fit = fitContain({ width: 0, height: 100 }, { width: 100, height: 100 });
    expect(fit.renderedSize).toEqual({ width: 0, height: 0 });
  });
});

describe("rectToOverlayBox", () => {
  it("offsets a rect by the letterbox margin", () => {
    const box = rectToOverlayBox(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 200, height: 100 }, // 2:1 image
      { width: 100, height: 100 }, // 1:1 container -> rendered 100x50, offset y=25
    );
    expect(box.left).toBe(0);
    expect(box.top).toBe(25);
    expect(box.width).toBe(50);
    expect(box.height).toBe(50);
  });
});
