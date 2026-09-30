// Pure geometry for turning an OCR region's bounding box, which is measured in
// the original photo's pixel coordinates, into CSS pixels for an overlay box
// drawn on top of the (possibly scaled down) <img> element on screen. No DOM
// in this file so it is cheap to unit test.

import type { Rect } from "./merge.ts";

export interface Size {
  width: number;
  height: number;
}

export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Suggested CSS font-size in px for the translated label inside this box. */
  fontSize: number;
}

const MIN_FONT_PX = 10;
const MAX_FONT_PX = 28;
/** Target the label's line height at this fraction of the box height. */
const FONT_TO_HEIGHT_RATIO = 0.7;

/**
 * Map a rect measured against `natural` (the original image's pixel size, for
 * example HTMLImageElement.naturalWidth/naturalHeight) onto `displayed` (the
 * element's on-screen box size, for example getBoundingClientRect()).
 * Assumes the image is shown with `object-fit: contain` inside a container of
 * exactly `displayed` size and no letterboxing, i.e. the two share an aspect
 * ratio (see fitContain below when they do not).
 */
export function scaleRectToDisplay(rect: Rect, natural: Size, displayed: Size): OverlayBox {
  if (natural.width <= 0 || natural.height <= 0) {
    throw new Error("natural size must be positive");
  }
  const scaleX = displayed.width / natural.width;
  const scaleY = displayed.height / natural.height;
  const width = rect.width * scaleX;
  const height = rect.height * scaleY;
  return {
    left: rect.x * scaleX,
    top: rect.y * scaleY,
    width,
    height,
    fontSize: clampFontSize(height),
  };
}

export function clampFontSize(boxHeightPx: number): number {
  const raw = boxHeightPx * FONT_TO_HEIGHT_RATIO;
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, raw));
}

export interface ContainFit {
  /** Size, in CSS px, that the image content actually occupies inside the container. */
  renderedSize: Size;
  /** Offset, in CSS px, from the container's top-left to the rendered content's top-left. */
  offset: { x: number; y: number };
}

/**
 * `object-fit: contain` letterboxes the image inside its container when the
 * aspect ratios differ (for example a portrait photo in a landscape stage on
 * desktop). Compute where the actual image content sits inside the container
 * so overlay boxes can be offset correctly instead of drifting into the
 * letterbox bars.
 */
export function fitContain(natural: Size, container: Size): ContainFit {
  if (natural.width <= 0 || natural.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { renderedSize: { width: 0, height: 0 }, offset: { x: 0, y: 0 } };
  }
  const naturalRatio = natural.width / natural.height;
  const containerRatio = container.width / container.height;
  let renderedSize: Size;
  if (naturalRatio > containerRatio) {
    // Image is relatively wider than the container: full width, letterbox top/bottom.
    renderedSize = { width: container.width, height: container.width / naturalRatio };
  } else {
    // Image is relatively taller: full height, letterbox left/right.
    renderedSize = { width: container.height * naturalRatio, height: container.height };
  }
  const offset = {
    x: (container.width - renderedSize.width) / 2,
    y: (container.height - renderedSize.height) / 2,
  };
  return { renderedSize, offset };
}

/** Convenience: scale a rect all the way from natural image space to the
 * on-screen container's coordinate space, accounting for contain letterboxing. */
export function rectToOverlayBox(rect: Rect, natural: Size, container: Size): OverlayBox {
  const { renderedSize, offset } = fitContain(natural, container);
  const box = scaleRectToDisplay(rect, natural, renderedSize);
  return { ...box, left: box.left + offset.x, top: box.top + offset.y };
}
