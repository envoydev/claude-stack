import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Priority, NewTask } from '../models/task.model';
import { TaskStore } from '../services/task-store.service';

/** Add-a-task form. Builds a NewTask and hands it to the store. */
@Component({
  selector: 'app-task-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="task-form">
      <input formControlName="title" placeholder="Task title" aria-label="Task title" />
      <input formControlName="description" placeholder="Description" aria-label="Task description" />
      <select formControlName="priority" aria-label="Priority">
        @for (p of priorities; track p) {
          <option [value]="p">{{ p }}</option>
        }
      </select>
      <input type="date" formControlName="dueDate" aria-label="Due date" />
      <button type="submit" [disabled]="form.invalid">Add</button>
      @if (justAdded()) {
        <span class="ok">Added ✓</span>
      }
    </form>
  `,
  styles: [`.task-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }`],
})
export class TaskFormComponent {
  private readonly store = inject(TaskStore);
  private readonly fb = inject(FormBuilder);
  protected readonly priorities = Object.values(Priority);
  protected readonly justAdded = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    priority: [Priority.Medium],
    dueDate: [''],
  });

  protected submit(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const payload: NewTask = {
      title: raw.title,
      description: raw.description,
      priority: raw.priority,
      dueDate: raw.dueDate || null,
    };
    this.store.add(payload);
    this.form.reset({ title: '', description: '', priority: Priority.Medium, dueDate: '' });
    this.justAdded.set(true);
  }
}
