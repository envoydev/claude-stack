import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { Priority, Task, TaskStatus } from '../models/task.model';

/**
 * Stand-in for a real HTTP backend. Returns seed data as an Observable so the
 * store exercises the async-load path exactly as it would against a REST API.
 */
@Injectable({ providedIn: 'root' })
export class TaskApiService {
  private readonly seed: Task[] = [
    this.make('Set up CI pipeline', 'GitHub Actions build + test', TaskStatus.Active, Priority.High, '2026-06-20', ['devops']),
    this.make('Write onboarding docs', 'README + first-run guide', TaskStatus.Todo, Priority.Medium, '2026-08-01', ['docs']),
    this.make('Fix flaky login test', 'Race in the auth spec', TaskStatus.Blocked, Priority.Critical, '2026-06-10', ['bug', 'auth']),
    this.make('Design dashboard', 'Stats + charts', TaskStatus.Done, Priority.Low, null, ['ui']),
    this.make('Upgrade Angular', 'Bump to latest, check breaking changes', TaskStatus.Todo, Priority.High, '2026-09-15', ['chore']),
    this.make('Add dark mode', 'Theme tokens + toggle', TaskStatus.Active, Priority.Low, null, ['ui']),
  ];

  /** Emits the seed set once, after a short delay, mimicking a network round-trip. */
  load(): Observable<Task[]> {
    return of(this.seed.map((t) => ({ ...t }))).pipe(delay(0));
  }

  private make(
    title: string,
    description: string,
    status: TaskStatus,
    priority: Priority,
    dueDate: string | null,
    tags: string[],
  ): Task {
    const stamp = '2026-06-01T00:00:00.000Z';
    return {
      id: `seed-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title,
      description,
      status,
      priority,
      dueDate,
      createdAt: stamp,
      updatedAt: stamp,
      tags,
    };
  }
}
