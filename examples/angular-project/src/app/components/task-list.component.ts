import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SortKey } from '../models/task.model';
import { TaskStore } from '../services/task-store.service';
import { TaskItemComponent } from './task-item.component';
import { TaskFilterComponent } from './task-filter.component';

/** The main list view: filter bar, sort controls, and the visible task rows. */
@Component({
  selector: 'app-task-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskItemComponent, TaskFilterComponent],
  template: `
    <section class="task-list">
      <header>
        <app-task-filter />
        <div class="sort">
          <label for="sort-key">Sort</label>
          <select id="sort-key" (change)="onSortKey($event)">
            @for (opt of sortKeys; track opt) {
              <option [value]="opt" [selected]="store.sort().key === opt">{{ opt }}</option>
            }
          </select>
          <button type="button" (click)="store.toggleSortDir()">
            {{ store.sort().dir === 'asc' ? '▲' : '▼' }}
          </button>
        </div>
      </header>

      <p class="count">{{ store.visibleCount() }} shown / {{ store.tasks().length }} total</p>

      @if (store.loading()) {
        <p class="loading">Loading…</p>
      } @else if (store.visibleTasks().length === 0) {
        <p class="empty">No tasks match the current filter.</p>
      } @else {
        <ul>
          @for (task of store.visibleTasks(); track task.id) {
            <app-task-item [task]="task" />
          }
        </ul>
      }

      @if (store.canUndo()) {
        <button type="button" class="undo" (click)="store.undo()">Undo</button>
      }
    </section>
  `,
  styles: [
    `
      header { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
      .count { font-size: 0.85rem; opacity: 0.7; }
      ul { list-style: none; padding: 0; }
    `,
  ],
})
export class TaskListComponent {
  protected readonly store = inject(TaskStore);
  protected readonly sortKeys: SortKey[] = ['priority', 'dueDate', 'title', 'createdAt'];

  protected onSortKey(event: Event): void {
    const key = (event.target as HTMLSelectElement).value as SortKey;
    this.store.setSort({ key, dir: this.store.sort().dir });
  }
}
