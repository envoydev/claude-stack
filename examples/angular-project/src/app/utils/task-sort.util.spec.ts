import { Priority, SortSpec, Task, TaskStatus } from '../models/task.model';
import { priorityRank, sortTasks, todayIso } from './task-sort.util';

function task(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? 't1',
    title: partial.title ?? 'title',
    description: partial.description ?? '',
    status: partial.status ?? TaskStatus.Todo,
    priority: partial.priority ?? Priority.Medium,
    dueDate: partial.dueDate ?? null,
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
    tags: partial.tags ?? [],
  };
}

describe('task-sort util', () => {
  it('ranks priority Critical highest', () => {
    expect(priorityRank(Priority.Critical)).toBeGreaterThan(priorityRank(Priority.High));
    expect(priorityRank(Priority.High)).toBeGreaterThan(priorityRank(Priority.Medium));
    expect(priorityRank(Priority.Medium)).toBeGreaterThan(priorityRank(Priority.Low));
  });

  it('sorts by priority descending without mutating the input', () => {
    const input = [
      task({ id: 'a', priority: Priority.Low }),
      task({ id: 'b', priority: Priority.Critical }),
      task({ id: 'c', priority: Priority.Medium }),
    ];
    const spec: SortSpec = { key: 'priority', dir: 'desc' };
    const sorted = sortTasks(input, spec);
    expect(sorted.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    // input order preserved (pure)
    expect(input.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by title ascending', () => {
    const input = [task({ id: 'a', title: 'Zebra' }), task({ id: 'b', title: 'Apple' })];
    const sorted = sortTasks(input, { key: 'title', dir: 'asc' });
    expect(sorted.map((t) => t.title)).toEqual(['Apple', 'Zebra']);
  });

  it('todayIso returns a yyyy-mm-dd string', () => {
    expect(todayIso(new Date('2026-07-07T12:00:00Z'))).toBe('2026-07-07');
  });
});
