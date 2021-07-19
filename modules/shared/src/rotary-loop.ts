import debug from 'debug';

export class RotaryLoop {
  private runningPromise?: Promise<unknown>;
  private stopResolve?: (value: unknown) => void;
  private stopping = false;

  constructor(
    private readonly debugPrefix: string,
    private readonly pollIntervalMs: number,
    private readonly pollOnce: () => Promise<void>,
  ) {}

  private get isRunning(): boolean {
    return this.runningPromise !== undefined;
  }

  public start = async (): Promise<void> => {
    const d = debug(`${this.debugPrefix}:start`);
    if (this.isRunning) throw new Error('already running');

    d('entering runner poll loop...');
    this.runningPromise = this.pollLoop();
    await this.runningPromise;
    d('...exited runner poll loop');
    delete this.runningPromise;
  };

  public stop = async (): Promise<void> => {
    const d = debug(`${this.debugPrefix}:stop`);
    if (!this.isRunning) return;

    d('stopping...');
    this.stopping = true;
    this.stopResolve(undefined);
    await this.runningPromise;
    delete this.runningPromise;
    this.stopping = false;
    d('...stopped');
  };

  private async pollLoop(): Promise<void> {
    const d = debug(`${this.debugPrefix}:pollLoop`);
    while (!this.stopping) {
      const stopPromise = new Promise((r) => (this.stopResolve = r));

      d('awake; calling pollOnce');
      try {
        await this.pollOnce();
      } catch (err) {
        console.log('pollOnce threw an error:', err);
      }

      // sleep until next polling time or stop requested
      d('sleeping');
      const ms = this.pollIntervalMs;
      const sleepPromise = new Promise((r) => setTimeout(r, ms, ms));
      await Promise.race([stopPromise, sleepPromise]);
      delete this.stopResolve;
    }
  }
}
