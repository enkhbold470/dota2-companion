import type { NormalizedState } from '@dc/shared';

export type Subscriber = (state: NormalizedState) => void;

export class Hub {
  private latest: NormalizedState | null = null;
  private subs = new Set<Subscriber>();

  update(state: NormalizedState): void {
    this.latest = state;
    for (const cb of this.subs) cb(state);
  }

  getLatest(): NormalizedState | null {
    return this.latest;
  }

  subscribe(cb: Subscriber): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }
}
