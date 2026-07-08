import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Priority, STATUS_LABELS, TaskStatus } from '../models/task.model';
import { PriorityLabelPipe } from '../pipes/priority-label.pipe';
import { isOverdue } from '../utils/task-sort.util';
import { TaskStore } from '../services/task-store.service';

/**
 * Routed detail view for a single task. The `id` comes from the route param
 * (withComponentInputBinding), and the task is looked up live from the store.
 */
@Component({
  selector: 'app-task-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PriorityLabelPipe],
  template: `
    @if (task(); as t) {
      <article class="detail">
        <a routerLink="/" class="back">← Back</a>
        <h2>{{ t.title }}</h2>
        <p class="desc">{{ t.description || 'No description.' }}</p>
        <dl>
          <dt>Status</dt>
          <dd>{{ statusLabel() }}</dd>
          <dt>Priority</dt>
          <dd>{{ t.priority | priorityLabel }}</dd>
          <dt>Due</dt>
          <dd [class.late]="overdue()">{{ t.dueDate ?? 'none' }}</dd>
          <dt>Tags</dt>
          <dd>{{ t.tags.length ? t.tags.join(', ') : 'none' }}</dd>
        </dl>
        <div class="actions">
          <button type="button" (click)="store.toggleDone(t.id)">
            {{ t.status === 'done' ? 'Reopen' : 'Mark done' }}
          </button>
          <button type="button" (click)="cycleStatus(t.status, t.id)">Cycle status</button>
          <button type="button" class="danger" (click)="store.remove(t.id)">Delete</button>
        </div>
      </article>
    } @else {
      <p class="missing">Task not found. <a routerLink="/">Back to list</a></p>
    }
  `,
  styles: [
    `
      .detail { max-width: 40rem; }
      dl { display: grid; grid-template-columns: 6rem 1fr; gap: 0.25rem 1rem; }
      dt { font-weight: 600; opacity: 0.7; }
      dd.late { color: #c0392b; }
      .actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
    `,
  ],
})
export class TaskDetailComponent {
  protected readonly store = inject(TaskStore);

  /** Bound from the :id route param via withComponentInputBinding. */
  readonly id = input<string>('');

  protected readonly task = computed(() => this.store.byId(this.id()));

  protected statusLabel(): string {
    const t = this.task();
    return t ? STATUS_LABELS[t.status] : '';
  }

  protected overdue(): boolean {
    const t = this.task();
    return t ? isOverdue(t) : false;
  }

  protected cycleStatus(current: TaskStatus, id: string): void {
    const order = [TaskStatus.Todo, TaskStatus.Active, TaskStatus.Blocked, TaskStatus.Done];
    const next = order[(order.indexOf(current) + 1) % order.length];
    this.store.setStatus(id, next);
  }
}
