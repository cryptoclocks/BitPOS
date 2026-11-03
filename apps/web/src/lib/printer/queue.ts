// One serial print queue per printer. It never retries by itself: a job whose outcome is not known stays "uncertain" until staff reprint it on purpose.
// Printing is local to this device and only reads the order; no state here can change a payment, stock or any other server record.
export type JobState = 'queued' | 'preparing' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled';
export interface PrintJob { id: number; key: string; label: string; state: JobState; sentPackets: number; totalPackets: number; error?: string; startedAt?: number; finishedAt?: number }
export interface PrintTransport { send(packets: Uint8Array[], options: { signal: AbortSignal; onProgress: (sent: number, total: number) => void }): Promise<void> }
export type BuildPackets = () => Promise<Uint8Array[]>;

export class PrintQueue {
  private jobs: PrintJob[] = []; private snap: readonly PrintJob[] = []; private builders = new Map<number, BuildPackets>(); private running = false; private seq = 0; private listeners = new Set<() => void>(); private abort?: AbortController;
  constructor(private transport: () => PrintTransport, private keep = 12) {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Stable between changes (safe for useSyncExternalStore); copies, so callers cannot mutate queue state. */
  snapshot(): readonly PrintJob[] { return this.snap; }
  private emit() { this.snap = this.jobs.map(j => ({ ...j })); for (const fn of this.listeners) fn(); }
  private update(job: PrintJob, patch: Partial<PrintJob>) { Object.assign(job, patch); this.emit(); }

  /** Queues a job. The same key cannot be queued twice while it is waiting or sending (double taps), and a key whose result is
   * "uncertain" is refused unless the caller says the staff member explicitly chose to print again. */
  enqueue(key: string, label: string, build: BuildPackets, options: { reprint?: boolean } = {}): PrintJob | { refused: 'DUPLICATE' | 'UNCERTAIN_REPRINT_REQUIRED'; job: PrintJob } {
    const live = this.jobs.find(j => j.key === key && ['queued', 'preparing', 'sending'].includes(j.state));
    if (live) return { refused: 'DUPLICATE', job: live };
    const unsure = [...this.jobs].reverse().find(j => j.key === key);
    if (unsure?.state === 'uncertain' && !options.reprint) return { refused: 'UNCERTAIN_REPRINT_REQUIRED', job: unsure };
    const job: PrintJob = { id: ++this.seq, key, label, state: 'queued', sentPackets: 0, totalPackets: 0 };
    this.jobs.push(job); this.builders.set(job.id, build);
    while (this.jobs.length > this.keep) { const old = this.jobs.findIndex(j => !['queued', 'preparing', 'sending'].includes(j.state)); if (old < 0) break; this.builders.delete(this.jobs[old]!.id); this.jobs.splice(old, 1); }
    this.emit(); void this.drain(); return job;
  }
  cancel(id: number) { const j = this.jobs.find(x => x.id === id); if (!j) return; if (j.state === 'queued') this.update(j, { state: 'cancelled', finishedAt: Date.now() }); else if (j.state === 'sending') this.abort?.abort(); }
  private async drain() {
    if (this.running) return; this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find(j => j.state === 'queued'); if (!job) break;
        const build = this.builders.get(job.id)!; this.builders.delete(job.id);
        this.update(job, { state: 'preparing', startedAt: Date.now() });
        let packets: Uint8Array[];
        try { packets = await build(); } catch (e) { this.update(job, { state: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() }); continue; }
        this.abort = new AbortController(); this.update(job, { state: 'sending', totalPackets: packets.length });
        try {
          await this.transport().send(packets, { signal: this.abort.signal, onProgress: (sent, total) => this.update(job, { sentPackets: sent, totalPackets: total }) });
          this.update(job, { state: 'sent', sentPackets: packets.length, finishedAt: Date.now() });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          // Nothing reached the printer: safe to say it did not print. Anything after the first byte may have printed in part or in full.
          this.update(job, { state: job.sentPackets === 0 ? 'failed' : 'uncertain', error, finishedAt: Date.now() });
        }
      }
    } finally { this.running = false; this.abort = undefined; }
  }
}
