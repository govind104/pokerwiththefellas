import { useEffect, useRef, useState } from 'react';
import type { HoldemAction, PlayerAction } from '@poker-blackjack/game-engine';
import type { BlackjackAvailability } from '../components/blackjackActions';
import type { HudLayout } from './TableHud';

interface Shortcut {
  key: string;
  enabled: boolean;
  run: () => void;
}

// One keydown listener for the prompts' shortcuts (base spec §B1). Typing in a field, modified keys
// and key repeat never act; Space on a focused button is left to the browser, which clicks it.
export function useShortcuts(shortcuts: Shortcut[]): void {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const key = e.key === ' ' ? 'Space' : e.key.toUpperCase();
      if (key === 'Space' && t?.tagName === 'BUTTON') return;
      const hit = ref.current.find((s) => s.key === key && s.enabled);
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Prompt({
  label,
  shortcut,
  disabled = false,
  title,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
      className="flex items-center gap-[0.5em] font-display text-[1.5em] text-parchment [text-shadow:0_0_0.6em_#000] hover:text-brass-bright disabled:cursor-not-allowed disabled:text-[#6d6150]"
    >
      {label}
      {shortcut && (
        <kbd aria-hidden="true" className="rounded-[0.35em] border border-current px-[0.45em] font-body text-[0.55em] leading-normal">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function LeaveLink({ onLeave }: { onLeave: () => void }) {
  return (
    <button type="button" onClick={onLeave} className="font-body text-[0.85em] text-fg-dim underline hover:text-parchment">
      Leave table
    </button>
  );
}

function containerClass(layout: HudLayout): string {
  return layout === 'overlay'
    ? 'flex flex-col items-end gap-[0.45em]'
    : 'flex flex-wrap items-center justify-center gap-x-[1.2em] gap-y-[0.5em]';
}

export interface HoldemPromptsProps {
  layout: HudLayout;
  showActions: boolean;
  toCall: number;
  maxRaise: number | null;
  resetKey: string;
  actionPending: boolean;
  onAction: (action: HoldemAction, amount?: number) => void;
  canReady: boolean;
  onReady: () => void;
  canLeave: boolean;
  onLeave: () => void;
}

export function HoldemPrompts(p: HoldemPromptsProps) {
  const [raiseAmount, setRaiseAmount] = useState(0);
  // A value typed on one street or turn must not leak into the next.
  useEffect(() => {
    setRaiseAmount(0);
  }, [p.resetKey]);
  const live = p.showActions && !p.actionPending;
  useShortcuts([
    { key: 'F', enabled: live, run: () => p.onAction('fold') },
    // C presses whichever of Check / Call is legal (deviation 3).
    { key: 'C', enabled: live, run: () => p.onAction(p.toCall > 0 ? 'call' : 'check') },
    { key: 'R', enabled: live, run: () => p.onAction('raise', raiseAmount) },
    { key: 'Space', enabled: p.canReady, run: p.onReady },
  ]);
  return (
    <div className={containerClass(p.layout)}>
      {p.showActions && (
        <>
          <Prompt label="Fold" shortcut="F" disabled={p.actionPending} onClick={() => p.onAction('fold')} />
          <Prompt
            label="Check"
            shortcut={p.toCall > 0 ? undefined : 'C'}
            disabled={p.actionPending || p.toCall > 0}
            title={p.toCall > 0 ? 'You are facing a bet' : undefined}
            onClick={() => p.onAction('check')}
          />
          <Prompt
            // toCall is already capped at the stack, so reaching it means the call puts everything in.
            label={p.toCall > 0 ? `Call ${p.toCall}${p.maxRaise !== null && p.toCall >= p.maxRaise ? ' (all in)' : ''}` : 'Call'}
            shortcut={p.toCall > 0 ? 'C' : undefined}
            disabled={p.actionPending || p.toCall === 0}
            title={p.toCall === 0 ? 'Nothing to call' : undefined}
            onClick={() => p.onAction('call')}
          />
          <span className="flex items-center gap-[0.5em]">
            <input
              type="number"
              value={raiseAmount}
              // Whole, non-negative chips only.
              onChange={(e) => setRaiseAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              aria-label="Raise amount"
              min={1}
              step={1}
              max={p.maxRaise ?? undefined}
              className="w-[5em] rounded border border-wood-grain bg-surface px-[0.4em] py-[0.2em] text-fg"
            />
            <Prompt label="Raise" shortcut="R" disabled={p.actionPending} onClick={() => p.onAction('raise', raiseAmount)} />
          </span>
          <Prompt label="All In" disabled={p.actionPending} onClick={() => p.onAction('all-in')} />
        </>
      )}
      {p.canReady && <Prompt label="Ready" shortcut="Space" onClick={p.onReady} />}
      {p.canLeave && <LeaveLink onLeave={p.onLeave} />}
    </div>
  );
}

export interface BlackjackPromptsProps {
  layout: HudLayout;
  showActions: boolean;
  can: BlackjackAvailability;
  actionPending: boolean;
  onAction: (action: PlayerAction) => void;
  canReady: boolean;
  onReady: () => void;
  canLeave: boolean;
  onLeave: () => void;
}

export function BlackjackPrompts(p: BlackjackPromptsProps) {
  const live = p.showActions && !p.actionPending;
  useShortcuts([
    { key: 'H', enabled: live, run: () => p.onAction('hit') },
    { key: 'S', enabled: live, run: () => p.onAction('stand') },
    { key: 'D', enabled: live && p.can.double, run: () => p.onAction('double') },
    { key: 'P', enabled: live && p.can.split, run: () => p.onAction('split') },
    { key: 'Space', enabled: p.canReady, run: p.onReady },
  ]);
  return (
    <div className={containerClass(p.layout)}>
      {p.showActions && (
        <>
          <Prompt label="Hit" shortcut="H" disabled={p.actionPending} onClick={() => p.onAction('hit')} />
          <Prompt label="Stand" shortcut="S" disabled={p.actionPending} onClick={() => p.onAction('stand')} />
          <Prompt
            label="Double"
            shortcut="D"
            disabled={p.actionPending || !p.can.double}
            title={p.can.double ? undefined : 'Only on your first two cards'}
            onClick={() => p.onAction('double')}
          />
          <Prompt
            label="Split"
            shortcut="P"
            disabled={p.actionPending || !p.can.split}
            title={p.can.split ? undefined : 'Only a pair, once per round'}
            onClick={() => p.onAction('split')}
          />
        </>
      )}
      {p.canReady && <Prompt label="Ready" shortcut="Space" onClick={p.onReady} />}
      {p.canLeave && <LeaveLink onLeave={p.onLeave} />}
    </div>
  );
}
