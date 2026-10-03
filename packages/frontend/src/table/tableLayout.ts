import { useEffect, useState } from 'react';
import type { HudLayout } from '../hud/TableHud';

// Which table view to show (Plan B spec §2.1). Gate 3 raised the width from 900 to 1200: at 900 px the
// smallest HUD text (card ranks, badges, status) rendered at 5-7 px, and a window snapped to half
// of a 1920 screen (960 px) is better served by the flat view.
export const OVERLAY_MIN_WIDTH = 1200;
export const OVERLAY_MIN_ASPECT = 1.25;

export type ViewPref = '3d' | 'flat';

export function chooseTableLayout({
  width,
  height,
  pref,
  failed,
}: {
  width: number;
  height: number;
  pref: ViewPref;
  failed: boolean;
}): HudLayout {
  if (pref === 'flat' || failed) return 'column';
  if (width < OVERLAY_MIN_WIDTH || height <= 0 || width / height < OVERLAY_MIN_ASPECT) return 'column';
  return 'overlay';
}

const VIEW_KEY = 'table.view';

// '2d' is what the old 2D/3D toggle stored for the 2D view, so existing choices carry over.
export function readViewPref(): ViewPref {
  try {
    return window.localStorage.getItem(VIEW_KEY) === '2d' ? 'flat' : '3d';
  } catch {
    return '3d';
  }
}

export function writeViewPref(p: ViewPref): void {
  try {
    window.localStorage.setItem(VIEW_KEY, p === 'flat' ? '2d' : '3d');
  } catch {
    /* preference just won't persist */
  }
}

// The window size, settled for `debounceMs` so dragging a window edge doesn't remount the canvas
// on every pixel.
export function useWindowSize(debounceMs = 200): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setSize({ width: window.innerWidth, height: window.innerHeight }), debounceMs);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [debounceMs]);
  return size;
}
