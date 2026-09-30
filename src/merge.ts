// Pure logic for turning Florence-2's raw OCR_WITH_REGION output into a small
// number of readable text regions, in reading order, ready to hand to the
// translator and the overlay. No DOM and no model calls in this file so it
// is cheap to unit test.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrRegion {
  text: string;
  rect: Rect;
  /** English translation of `text`, filled in after OCR by the translation model. */
  translated?: string;
}

/** Florence-2 returns an 8-number quad box: x1,y1,x2,y2,x3,y3,x4,y4 (corners, not
 * necessarily axis aligned). We only need an axis-aligned bounding rect for layout. */
export function quadToRect(quad: number[]): Rect {
  if (quad.length !== 8) {
    throw new Error(`Expected an 8-value quad box, got ${quad.length} values`);
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Florence-2 sometimes leaves stray <loc_NNN> location tokens inside a label
 * when generation is cut off mid-token. Strip them and collapse whitespace. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(/<\/?loc_\d+>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Zip Florence-2's parallel `labels` and `quad_boxes` arrays into regions,
 * dropping anything that cleans up to empty text or a degenerate box. */
export function buildRegions(labels: string[], quadBoxes: number[][]): OcrRegion[] {
  const regions: OcrRegion[] = [];
  const n = Math.min(labels.length, quadBoxes.length);
  for (let i = 0; i < n; i++) {
    const text = cleanLabel(labels[i]);
    if (!text) continue;
    const rect = quadToRect(quadBoxes[i]);
    if (rect.width <= 0 || rect.height <= 0) continue;
    regions.push({ text, rect });
  }
  return regions;
}

/** Reading order: group into rows by vertical overlap, top row first, then
 * left to right within a row. This matches how a person scans a sign. */
export function sortReadingOrder(regions: OcrRegion[]): OcrRegion[] {
  return [...regions].sort((a, b) => {
    const aCenterY = a.rect.y + a.rect.height / 2;
    const bCenterY = b.rect.y + b.rect.height / 2;
    const sameRow = Math.abs(aCenterY - bCenterY) < Math.min(a.rect.height, b.rect.height) * 0.6;
    if (sameRow) return a.rect.x - b.rect.x;
    return aCenterY - bCenterY;
  });
}

export interface MergeOptions {
  /** Max vertical center offset, as a fraction of the shorter box height,
   * for two regions to be considered on the same line. */
  lineToleranceRatio?: number;
  /** Max horizontal gap, as a fraction of the average box height, before two
   * same-line regions are treated as separate words rather than merged. */
  maxGapRatio?: number;
}

const DEFAULT_OPTIONS: Required<MergeOptions> = {
  lineToleranceRatio: 0.6,
  maxGapRatio: 2.5,
};

/**
 * Florence-2's OCR_WITH_REGION frequently splits one line of text (for
 * example a menu item and its price) into several short regions. Merge
 * adjacent regions that sit on the same line and are close together into one
 * region with concatenated text and a unioned bounding box, so the overlay
 * shows one translated line instead of several overlapping fragments.
 */
export function mergeAdjacentRegions(regions: OcrRegion[], options: MergeOptions = {}): OcrRegion[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ordered = sortReadingOrder(regions);
  const merged: OcrRegion[] = [];

  for (const region of ordered) {
    const last = merged[merged.length - 1];
    if (last && shouldMerge(last, region, opts)) {
      merged[merged.length - 1] = unionRegions(last, region);
    } else {
      merged.push({ ...region, rect: { ...region.rect } });
    }
  }
  return merged;
}

function shouldMerge(a: OcrRegion, b: OcrRegion, opts: Required<MergeOptions>): boolean {
  const aCenterY = a.rect.y + a.rect.height / 2;
  const bCenterY = b.rect.y + b.rect.height / 2;
  const avgHeight = (a.rect.height + b.rect.height) / 2;
  const sameLine = Math.abs(aCenterY - bCenterY) < avgHeight * opts.lineToleranceRatio;
  if (!sameLine) return false;

  const aRight = a.rect.x + a.rect.width;
  const gap = b.rect.x - aRight;
  return gap <= avgHeight * opts.maxGapRatio;
}

function unionRegions(a: OcrRegion, b: OcrRegion): OcrRegion {
  const minX = Math.min(a.rect.x, b.rect.x);
  const minY = Math.min(a.rect.y, b.rect.y);
  const maxX = Math.max(a.rect.x + a.rect.width, b.rect.x + b.rect.width);
  const maxY = Math.max(a.rect.y + a.rect.height, b.rect.y + b.rect.height);
  return {
    text: `${a.text} ${b.text}`.trim(),
    rect: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
