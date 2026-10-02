// Test helper: a stand-in 2D canvas context (jsdom has none) that records every drawing call with
// the fill style and font in force when it was made. measureText reports 20 px per character and
// createPattern returns null.

export interface CanvasCall {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  font: string;
}

export function recordingContext(): { ctx: CanvasRenderingContext2D; calls: CanvasCall[] } {
  const calls: CanvasCall[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    globalAlpha: 1,
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      const name = String(prop);
      if (name in target) return target[name];
      if (name === 'measureText') return (text: string) => ({ width: text.length * 20 });
      if (name === 'createPattern') return () => null;
      return (...args: unknown[]) => {
        calls.push({ name, args, fillStyle: target.fillStyle, font: String(target.font) });
      };
    },
    set(target, prop, value) {
      target[String(prop)] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
