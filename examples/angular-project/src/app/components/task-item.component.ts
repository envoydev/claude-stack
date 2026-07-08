import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Task, STATUS_LABELS } from '../models/task.model';
import { PriorityBadgeComponent } from './priority-badge.component';
import { isOverdue } from '../utils/task-sort.util';
import { TaskStore } from '../services/task-store.service';

/** A single task row. Presentational, OnPush - it reads the input and delegates to the store. */
@Component({
  selector: 'app-task-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PriorityBadgeComponent],
  template: `
    <li class="task-item" [class.done]="task().status === 'done'" [class.overdue]="overdue">
      <input
        type="checkbox"
        [checked]="task().status === 'done'"
        (change)="store.toggleDone(task().id)"
        [attr.aria-label]="'Toggle ' + task().title"
      />
      <div class="body">
        <a [routerLink]="['/task', task().id]" class="title">{{ task().title }}</a>
        <div class="meta">
          <span class="status">{{ statusLabel }}</span>
          <app-priority-badge [priority]="task().priority" />
          @if (task().dueDate) {
            <span class="due" [class.late]="overdue">{{ task().dueDate }}</span>
          }
          @for (tag of task().tags; track tag) {
            <span class="tag">{{ tag }}</span>
          }
        </div>
      </div>
      <button type="button" class="remove" (click)="store.remove(task().id)" aria-label="Remove task">×</button>
    </li>
  `,
  styles: [
    `
      .task-item { display: flex; gap: 0.5rem; align-items: center; padding: 0.4rem 0; }
      .task-item.done .title { text-decoration: line-through; opacity: 0.6; }
      .task-item.overdue .due.late { color: #c0392b; font-weight: 600; }
      .meta { display: flex; gap: 0.5rem; font-size: 0.8rem; opacity: 0.8; }
      .remove { margin-left: auto; }
    `,
  ],
})
export class TaskItemComponent {
  protected readonly store = inject(TaskStore);
  readonly task = input.required<Task>();

  get statusLabel(): string {
    return STATUS_LABELS[this.task().status];
  }

  get overdue(): boolean {
    return isOverdue(this.task());
  }
}
