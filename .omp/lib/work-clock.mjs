export function formatSeconds(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return value < 60 ? value + 's' : value < 3600 ? Math.floor(value / 60) + 'm' + String(value % 60).padStart(2, '0') + 's' : Math.floor(value / 3600) + 'h' + String(Math.floor(value / 60) % 60).padStart(2, '0') + 'm';
}

/** Duration ledger only. No inference, process control or acceptance decisions. */
export class WorkClock {
  constructor({ now = Date.now, gapLimitMs = 90000 } = {}) {
    this.now = now; this.gapLimitMs = gapLimitMs; this.unit = null;
  }
  start({ id, label, lowMinutes = null, highMinutes = null, estimateSource = 'unknown', diagnostic = false }) {
    if (this.unit?.status === 'running') throw Error('Finish the current unit before replacing its clock');
    if (typeof id !== 'string' || !id || typeof label !== 'string' || !label) throw Error('Unit id and label required');
    if ((lowMinutes === null) !== (highMinutes === null) || lowMinutes !== null && (!Number.isFinite(lowMinutes) || !Number.isFinite(highMinutes) || lowMinutes <= 0 || highMinutes < lowMinutes || highMinutes > 1440)) throw Error('Invalid estimate range');
    const at = this.now();
    this.unit = { id, label: label.slice(0, 100), startedAt: at, lastAt: at, activeMs: 0, waitMs: 0, unknownMs: 0,
      lowMinutes, highMinutes, estimateSource, diagnostic, status: 'running', reasons: [], diagnosticState: 'none' };
    return this.snapshot();
  }
  sample() {
    const u = this.unit; if (!u || u.status !== 'running') return;
    const at = this.now(), delta = Math.max(0, at - u.lastAt); u.lastAt = at;
    if (u.reasons.length) u.waitMs += delta;
    else if (delta > this.gapLimitMs) u.unknownMs += delta;
    else u.activeMs += delta;
  }
  pause(reason) { this.sample(); if (this.unit?.status === 'running' && !this.unit.reasons.includes(reason)) this.unit.reasons.push(reason); }
  resume(reason) { this.sample(); if (this.unit) this.unit.reasons = this.unit.reasons.filter(x => x !== reason); }
  estimate(lowMinutes, highMinutes) {
    if (!this.unit || !(lowMinutes > 0 && highMinutes >= lowMinutes && highMinutes <= 1440)) throw Error('Invalid estimate');
    this.sample(); const u = this.unit;
    // Keep the original baseline so re-estimation cannot conceal an overrun.
    if (u.originalEstimate === undefined) u.originalEstimate = { lowMinutes: u.lowMinutes, highMinutes: u.highMinutes, source: u.estimateSource };
    u.lowMinutes = lowMinutes; u.highMinutes = highMinutes; u.estimateSource = 'model_revised';
  }
  finish(status = 'done') { this.sample(); if (this.unit) { this.unit.status = status; this.unit.finishedAt = this.now(); } return this.snapshot(); }
  snapshot() {
    this.sample(); if (!this.unit) return null;
    const u = this.unit, end = u.finishedAt ?? this.now();
    const baseline = u.originalEstimate?.highMinutes ?? u.highMinutes;
    const thresholdMs = baseline === null ? null : Math.max(baseline * 2, baseline + 10) * 60000;
    return { ...u, reasons: [...u.reasons], elapsedMs: Math.max(0, end - u.startedAt), thresholdMs,
      overdue: u.status === 'running' && thresholdMs !== null && u.activeMs >= thresholdMs,
      remainingLowMs: u.lowMinutes === null ? null : Math.max(0, u.lowMinutes * 60000 - u.activeMs),
      remainingHighMs: u.highMinutes === null ? null : Math.max(0, u.highMinutes * 60000 - u.activeMs) };
  }
  reserveDiagnosis() {
    const state = this.snapshot();
    if (!state?.overdue || state.diagnostic || state.reasons.length || state.diagnosticState !== 'none') return false;
    this.unit.diagnosticState = 'queued'; return true;
  }
}

export function clockLine(u) {
  if (!u) return 'Clock ready · ETA unset';
  const estimate = u.lowMinutes === null ? 'unknown' : u.lowMinutes + '–' + u.highMinutes + 'm' + (u.estimateSource === 'auto' ? ' auto' : '');
  return `${u.label} | ETA ${estimate} | actual ${formatSeconds(u.elapsedMs / 1000)} | active ${formatSeconds(u.activeMs / 1000)} | wait ${formatSeconds(u.waitMs / 1000)}` +
    (u.unknownMs ? ` | unobserved ${formatSeconds(u.unknownMs / 1000)}` : '') +
    (u.reasons.length ? ` | PAUSED ${u.reasons.join(',')}` : u.overdue ? ' | OVERDUE' : '') +
    (u.diagnosticState !== 'none' ? ' | HIGH ' + u.diagnosticState : '');
}
