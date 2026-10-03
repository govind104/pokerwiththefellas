import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HUD_ZONES } from '../three/hudZones';
import { fitScale } from './hudModel';

export type HudLayout = 'overlay' | 'column';

const PLAYERS_ZONE = HUD_ZONES.find((z) => z.name === 'players') as (typeof HUD_ZONES)[number];
// The sketch draws the player list at 85% (base spec D5).
const LIST_SCALE = 0.85;
const PANEL_BOX = 'rounded-md border border-wood-grain bg-[rgba(12,8,5,0.72)]';

// Overlay: the three corner panels over the 3D canvas, sized in em of a 1vw root so they match
// the approved sketch at every window size. Column: the same panels stacked on flat felt, with
// the prompts pinned to the bottom so they never scroll away (Plan B spec §3 item 1).
export function TableHud({ layout, panel, players, prompts }: { layout: HudLayout; panel: ReactNode; players: ReactNode; prompts: ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  useLayoutEffect(() => {
    if (layout !== 'overlay') return;
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      // Keep the list inside the players zone that Plan A's layout keeps free of cards.
      const available = window.innerHeight * PLAYERS_ZONE.h - 0.012 * window.innerWidth;
      setFit(fitScale(el.offsetHeight * LIST_SCALE, available));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [layout]);

  if (layout === 'overlay') {
    return (
      <div className="pointer-events-none absolute inset-0 font-body" style={{ fontSize: '1vw' }}>
        {panel && <div className="pointer-events-auto absolute right-[1.2em] top-[1.2em]">{panel}</div>}
        <div
          ref={listRef}
          className="pointer-events-auto absolute bottom-[1.2em] left-[1.2em]"
          style={{ transform: `scale(${LIST_SCALE * fit})`, transformOrigin: 'bottom left' }}
        >
          {players}
        </div>
        <div className="pointer-events-auto absolute bottom-[1.4em] right-[1.6em]">{prompts}</div>
      </div>
    );
  }
  return (
    <div className="font-body" style={{ fontSize: '12px' }}>
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-[14px] px-[14px] pb-[140px] pt-[56px]">
        {panel && <div className={`${PANEL_BOX} px-3 py-2.5`}>{panel}</div>}
        <div className={`${PANEL_BOX} p-2`}>{players}</div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-wood-grain bg-[rgba(8,5,3,0.94)] px-[14px] py-[10px]">
        <div className="mx-auto max-w-[560px]">{prompts}</div>
      </div>
    </div>
  );
}
