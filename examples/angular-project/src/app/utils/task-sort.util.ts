import { Priority, SortSpec, Task, TaskStatus } from '../models/task.model';

/**
 * Pure helpers for ordering and dating tasks. Kept framework-free so they are
 * trivially unit-testable and reusable from the store, the components and specs.
 */

const PRIORITY_ORDER: Record<Priority, number> = {
  [Priority.Low]: 0,
  [Priority.Medium]: 1,
  [Priority.High]: 2,
  [Priority.Critical]: 3,
};

/** Higher number == more urgent. Used for priority sorting and stats weighting. */
export function priorityRank(priority: Priority): number {
  return PRIORITY_ORDER[priority];
}

/** yyyy-mm-dd for the given date (defaults to now), so comparisons are string-safe. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A task is overdue when it has a deadline in the past and is not yet Done.
 * dueDate and today are both yyyy-mm-dd, so a lexical compare is a date compare.
 */
export function isOverdue(task: Task, today: string = todayIso()): boolean {
  if (!task.dueDate) return false;
  if (task.status === TaskStatus.Done) return false;
  return task.dueDate > today;
}

function compareOne(a: Task, b: Task, spec: SortSpec): number {
  let delta = 0;
  switch (spec.key) {
    case 'priority':
      delta = priorityRank(a.priority) - priorityRank(b.priority);
      break;
    case 'dueDate':
      delta = (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
      break;
    case 'title':
      delta = a.title.localeCompare(b.title);
      break;
    case 'createdAt':
      delta = a.createdAt.localeCompare(b.createdAt);
      break;
  }
  return spec.dir === 'asc' ? delta : -delta;
}

/** Returns a new, sorted array; never mutates the input. */
export function sortTasks(tasks: readonly Task[], spec: SortSpec): Task[] {
  return [...tasks].sort((a, b) => {
    const primary = compareOne(a, b, spec);
    if (primary !== 0) return primary;
    // Stable tie-break: newest first, then title, so order is deterministic.
    return b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title);
  });
}
