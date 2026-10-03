import type { PanelModel } from './hudModel';
import type { HudLayout } from './TableHud';
import { MiniCard } from './MiniCard';

const LABEL = 'mt-[0.5em] font-display text-[1.6em] text-parchment [text-shadow:0_0_0.6em_#000]';
const SMALL = 'mr-[0.6em] font-body text-[0.6em] text-fg-dim';

export function TablePanel({ panel, layout }: { panel: PanelModel; layout: HudLayout }) {
  const align = layout === 'overlay' ? 'items-end text-right' : 'items-center text-center';
  if (panel.kind === 'holdem') {
    return (
      <section aria-label="Board" data-testid="hud-board" className={`flex flex-col ${align}`}>
        <div className="flex gap-[0.5em]">
          {panel.board.map((card, i) => (
            <MiniCard key={i} card={card} size="lg" />
          ))}
        </div>
        <p className={LABEL}>
          <span className={SMALL}>{panel.street}</span>
          <span data-testid="hud-pot">Pot {panel.pot}</span>
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Dealer" data-testid="hud-dealer" className={`flex flex-col ${align}`}>
      <div className="flex gap-[0.5em]">
        {panel.cards.map((card, i) => (
          <MiniCard key={i} card={card} size="lg" />
        ))}
      </div>
      <p className={LABEL}>
        <span className={SMALL}>Dealer</span>
        <span data-testid="hud-dealer-total">{panel.total}</span>
      </p>
    </section>
  );
}
