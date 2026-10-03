import type { HudRow, StatusTone } from './hudModel';
import { MiniCard } from './MiniCard';

const TONE: Record<StatusTone, string> = {
  plain: 'text-fg-dim',
  turn: 'text-brass-bright',
  win: 'text-win-bright',
  lose: 'text-ember-text',
  push: 'text-parchment-dim',
  alert: 'text-ember-text',
};

export function PlayerList({ rows, clockSeconds }: { rows: HudRow[]; clockSeconds: number | null }) {
  return (
    <ul aria-label="Players" className="flex flex-col gap-[0.45em]">
      {rows.map((row) => (
        <PlayerRow key={row.seatIndex} row={row} clockSeconds={row.tone === 'turn' ? clockSeconds : null} />
      ))}
    </ul>
  );
}

function PlayerRow({ row, clockSeconds }: { row: HudRow; clockSeconds: number | null }) {
  const edge = row.won
    ? 'border-[#ffc45c] shadow-[0_0_1.2em_rgba(255,196,92,0.55)]'
    : row.isActive
      ? 'border-brass-bright shadow-[0_0_1em_rgba(243,210,122,0.35)]'
      : row.isMe
        ? 'border-brass'
        : 'border-transparent';
  // Under 10 s the countdown turns red (Plan B spec §3 item 3).
  const urgent = clockSeconds !== null && clockSeconds < 10;
  return (
    <li
      data-testid={`hud-player-${row.seatIndex}`}
      data-active={row.isActive ? 'true' : 'false'}
      data-won={row.won ? 'true' : 'false'}
      className={`flex min-w-[17em] items-center gap-[0.7em] border-l-[0.25em] bg-[rgba(12,8,5,0.72)] py-[0.4em] pl-[0.4em] pr-[0.9em] text-parchment ${edge} ${row.dimmed ? 'opacity-50' : ''}`}
    >
      <span aria-hidden="true" className="grid h-[2.8em] w-[2.8em] flex-none place-items-center rounded-full border-[0.15em] border-brass bg-wood font-display text-brass-bright">
        <span className="text-[1.5em] leading-none">{row.name[0]?.toUpperCase()}</span>
      </span>
      <div className="min-w-0">
        <div className="font-display text-[1.9em] leading-none">{row.balance}</div>
        <div className="mt-[0.15em] flex flex-wrap items-center gap-x-[0.35em] whitespace-nowrap text-[0.95em] text-fg-dim">
          <span className={row.isMe ? 'font-semibold text-parchment' : undefined}>{row.name}</span>
          {row.bet !== null && (
            <span>
              · bet <b className="text-parchment">{row.bet}</b>
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span className={TONE[row.tone]}>{row.status}</span>
          {clockSeconds !== null && (
            <span data-testid="hud-clock" data-urgent={urgent ? 'true' : 'false'} className={`font-semibold ${urgent ? 'text-[#ff6b5e]' : 'text-brass-bright'}`}>
              · {clockSeconds}s
            </span>
          )}
          {row.badges.map((b) => (
            <span key={b} className={`rounded-[0.3em] px-[0.35em] text-[0.85em] font-semibold text-ink ${b === 'D' ? 'bg-parchment' : 'bg-brass'}`}>
              {b}
            </span>
          ))}
        </div>
        {row.handName && <div className="mt-[0.15em] text-[0.95em] italic text-parchment">{row.handName}</div>}
      </div>
      {row.groups.length > 0 && (
        <div className="ml-auto flex gap-[0.6em] pl-[0.6em]">
          {row.groups.map((g, i) => (
            <span key={i} data-testid={`hud-cards-${row.seatIndex}-${i}`} className="flex items-center gap-[0.2em]">
              {g.cards.map((card, j) => (
                <MiniCard key={j} card={card} />
              ))}
              {g.total && <span className="ml-[0.3em] font-display text-[1.4em]">{g.total}</span>}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
