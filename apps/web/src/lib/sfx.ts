// Short synthesized cues for the counter (no audio files, nothing fetched). They only play after the person has interacted with the
// page, honour a mute switch kept in this browser, and never throw: a missing or blocked audio engine just stays silent.
export type Cue = 'add' | 'remove' | 'order';
const KEY = 'bitpos.sfx.muted';
const NOTES: Record<Cue, { f: number; at: number; len: number; type: OscillatorType; gain: number }[]> = {
  add: [{ f: 880, at: 0, len: 0.07, type: 'sine', gain: 0.08 }, { f: 1320, at: 0.05, len: 0.09, type: 'sine', gain: 0.06 }],
  remove: [{ f: 440, at: 0, len: 0.09, type: 'triangle', gain: 0.07 }, { f: 294, at: 0.06, len: 0.11, type: 'triangle', gain: 0.06 }],
  order: [{ f: 659, at: 0, len: 0.14, type: 'sine', gain: 0.09 }, { f: 880, at: 0.14, len: 0.14, type: 'sine', gain: 0.09 }, { f: 1175, at: 0.28, len: 0.24, type: 'sine', gain: 0.09 }],
};
let ctx: AudioContext | undefined;
export function isMuted(): boolean { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export function setMuted(value: boolean): void { try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* storage unavailable: stays for this page only */ } }
/** Plays one cue unless muted. Returns whether a sound was actually scheduled. */
export function play(cue: Cue): boolean {
  if (typeof window === 'undefined' || isMuted()) return false;
  try {
    const Engine = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Engine) return false;
    ctx ??= new Engine();
    if (ctx.state === 'suspended') void ctx.resume();
    if (ctx.state !== 'running' && ctx.state !== 'suspended') return false;
    const start = ctx.currentTime + 0.01;
    for (const n of NOTES[cue]) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = n.type; osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, start + n.at);
      gain.gain.exponentialRampToValueAtTime(n.gain, start + n.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + n.len);
      osc.connect(gain).connect(ctx.destination); osc.start(start + n.at); osc.stop(start + n.at + n.len + 0.02);
    }
    return true;
  } catch { return false; }
}
/** Which cue a change in the cart quantity or in the number of paid orders deserves; null when nothing should sound. */
export function cueForChange(kind: 'cart' | 'paid', before: number | null, after: number): Cue | null {
  if (before === null || after === before) return null;
  if (kind === 'cart') return after > before ? 'add' : 'remove';
  return after > before ? 'order' : null;
}
