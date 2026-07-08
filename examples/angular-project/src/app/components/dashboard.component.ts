import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { STATUS_LABELS, TaskStatus } from '../models/task.model';
import { TaskStore } from '../services/task-store.service';

/** Read-only stats panel: counts by status, overdue tally, completion progress. */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dashboard">
      <h2>Overview</h2>
      <div class="cards">
        <div class="card">
          <span class="n">{{ stats().total }}</span>
          <span class="l">Total</span>
        </div>
        <div class="card">
          <span class="n">{{ stats().overdue }}</span>
          <span class="l">Overdue</span>
        </div>
        @for (row of statusRows(); track row.status) {
          <div class="card">
            <span class="n">{{ row.count }}</span>
            <span class="l">{{ row.label }}</span>
          </div>
        }
      </div>

      <div class="progress" aria-label="Completion">
        <div class="bar" [style.width.%]="percent()"></div>
        <span class="pct">{{ percent() }}% complete</span>
      </div>

      @if (store.focusTask(); as focus) {
        <p class="focus">Next up: <strong>{{ focus.title }}</strong> ({{ focus.priority }})</p>
      }
    </section>
  `,
  styles: [
    `
      .cards { display: flex; gap: 1rem; flex-wrap: wrap; }
      .card { display: flex; flex-direction: column; padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 6px; }
      .card .n { font-size: 1.5rem; font-weight: 700; }
      .card .l { font-size: 0.75rem; opacity: 0.7; }
      .progress { position: relative; height: 1.25rem; background: #eee; border-radius: 6px; margin-top: 1rem; }
      .progress .bar { height: 100%; background: #2ecc71; border-radius: 6px; }
      .progress .pct { position: absolute; inset: 0; text-align: center; font-size: 0.8rem; }
    `,
  ],
})
export class DashboardComponent {
  protected readonly store = inject(TaskStore);
  protected readonly stats = this.store.stats;

  protected readonly statusRows = computed(() =>
    Object.values(TaskStatus).map((status) => ({
      status,
      label: STATUS_LABELS[status],
      count: this.stats().byStatus[status],
    })),
  );

  /** completionRate is a 0..1 fraction; render it as a whole percent. */
  protected readonly percent = computed(() => Math.round(this.stats().completionRate * 100));
}
