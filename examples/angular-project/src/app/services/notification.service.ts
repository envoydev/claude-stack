import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

/**
 * Tiny toast queue. Note: this service also exposes a `clear()` method, the same
 * name the TaskStore uses for a completely different purpose - a deliberate
 * duplicate so a semantic lookup can be compared against a plain-text grep.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private seq = 0;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  push(text: string, kind: Toast['kind'] = 'info'): void {
    this._toasts.update((list) => [...list, { id: ++this.seq, kind, text }]);
  }

  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Removes every queued toast. Same name, different meaning from TaskStore.clear(). */
  clear(): void {
    this._toasts.set([]);
  }
}
