import { describe, it, expect } from 'vitest';
import { cropToPixels, DRAFT_BAR_CROP, DRAFT_BAR_OPTIONS } from './frame';

describe('cropToPixels', () => {
  it('maps the draft-bar crop onto a 1080p frame', () => {
    expect(cropToPixels(DRAFT_BAR_CROP, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 130 });
  });

  it('maps fractional rects and clamps to the frame', () => {
    expect(cropToPixels({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 1000, 800)).toEqual({ sx: 500, sy: 400, sw: 500, sh: 400 });
    // Overshooting width/height is clamped to the remaining frame.
    expect(cropToPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 1000, 800)).toEqual({ sx: 900, sy: 720, sw: 100, sh: 80 });
  });

  it('never returns a zero-sized rect', () => {
    const r = cropToPixels({ x: 0, y: 0, w: 0, h: 0 }, 1000, 800);
    expect(r.sw).toBeGreaterThan(0);
    expect(r.sh).toBeGreaterThan(0);
  });
});

describe('DRAFT_BAR_OPTIONS', () => {
  it('keeps full 1080p width and high JPEG quality for the vision scan', () => {
    expect(DRAFT_BAR_OPTIONS.maxW).toBe(1920);
    expect(DRAFT_BAR_OPTIONS.quality).toBe(0.9);
    expect(DRAFT_BAR_OPTIONS.crop).toEqual(DRAFT_BAR_CROP);
  });
});
