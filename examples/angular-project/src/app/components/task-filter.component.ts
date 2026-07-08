import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Priority, TaskStatus } from '../models/task.model';
import { TaskStore } from '../services/task-store.service';

/**
 * Filter bar. Writes filter changes into the store; the list re-projects from
 * the store's `visibleTasks`. Reads the current filter back for two-way binding.
 */
@Component({
  selector: 'app-task-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="filter-bar">
      <input
        type="search"
        placeholder="Search title or description"
        [ngModel]="store.filter().text"
        (ngModelChange)="store.patchFilter({ text: $event })"
        aria-label="Search tasks"
      />
      <select
        [ngModel]="store.filter().status"
        (ngModelChange)="store.patchFilter({ status: $event })"
        aria-label="Filter by status"
      >
        <option value="all">All statuses</option>
        @for (s of statuses; track s) {
          <option [value]="s">{{ s }}</option>
        }
      </select>
      <select
        [ngModel]="store.filter().priority"
        (ngModelChange)="store.patchFilter({ priority: $event })"
        aria-label="Filter by priority"
      >
        <option value="all">All priorities</option>
        @for (p of priorities; track p) {
          <option [value]="p">{{ p }}</option>
        }
      </select>
      <label class="overdue-toggle">
        <input
          type="checkbox"
          [ngModel]="store.filter().overdueOnly"
          (ngModelChange)="store.patchFilter({ overdueOnly: $event })"
        />
        Overdue only
      </label>
      <button type="button" (click)="store.resetFilter()">Reset</button>
    </div>
  `,
  styles: [`.filter-bar { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }`],
})
export class TaskFilterComponent {
  protected readonly store = inject(TaskStore);
  protected readonly statuses = Object.values(TaskStatus);
  protected readonly priorities = Object.values(Priority);
}
