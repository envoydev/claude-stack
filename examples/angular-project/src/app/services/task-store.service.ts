import { computed, effect, inject, Injectable, signal, Signal } from '@angular/core';
import {
  DEFAULT_FILTER,
  DEFAULT_SORT,
  NewTask,
  Priority,
  SortSpec,
  Task,
  TaskFilter,
  TaskStats,
  TaskStatus,
} from '../models/task.model';
import { isOverdue, priorityRank, sortTasks, todayIso } from '../utils/task-sort.util';
import { TaskApiService } from './task-api.service';
import { NotificationService } from './notification.service';

const STORAGE_KEY = 'angular-playground.tasks.v1';
const MAX_UNDO = 20;

/**
 * The single source of truth for tasks. Everything the UI shows is a computed
 * projection of the private `_tasks` signal, so components stay dumb and read-only.
 *
 * This class is injected by every feature component (list, item, form, filter,
 * dashboard, detail) and the app shell, which is why it is the reference-heavy
 * symbol used to compare `find_referencing_symbols` against a callers grep.
 */
@Injectable({ providedIn: 'root' })
export class TaskStore {
  private readonly api = inject(TaskApiService);
  private readonly notify = inject(NotificationService);

  /** Raw, unfiltered task list - the one writable piece of state. */
  private readonly _tasks = signal<Task[]>([]);

  /** Current sort order. */
  private readonly _sort = signal<SortSpec>({ ...DEFAULT_SORT });

  /** Current filter predicate set. */
  private _filter: TaskFilter = { ...DEFAULT_FILTER };

  /** True while the initial async load is in flight. */
  private readonly _loading = signal<boolean>(false);

  /** Snapshots for undo, most-recent last. */
  private readonly _undo = signal<Task[][]>([]);

  // ---- Public read-only surface -------------------------------------------

  readonly tasks: Signal<Task[]> = this._tasks.asReadonly();
  readonly sort: Signal<SortSpec> = this._sort.asReadonly();
  readonly loading: Signal<boolean> = this._loading.asReadonly();
  readonly canUndo = computed(() => this._undo().length > 0);

  /**
   * Tasks passing the current filter. Downstream of `visibleTasks`.
   */
  readonly filteredTasks = computed(() => this.applyFilter(this._tasks(), this._filter));

  /** Filtered then sorted - what the list view binds to. */
  readonly visibleTasks = computed(() => sortTasks(this.filteredTasks(), this._sort()));

  /** Just the overdue tasks, newest deadline first. */
  readonly overdueTasks = computed(() => {
    const today = todayIso();
    return this._tasks().filter((t) => isOverdue(t, today));
  });

  /** Aggregate figures for the dashboard. */
  readonly stats: Signal<TaskStats> = computed(() => this.computeStats(this._tasks()));

  /** Count passing the current filter, for the list header. */
  readonly visibleCount = computed(() => this.filteredTasks().length);

  /** The single highest-priority not-Done task, or null. */
  readonly focusTask = computed<Task | null>(() => {
    const open = this._tasks().filter((t) => t.status !== TaskStatus.Done);
    if (open.length === 0) return null;
    return [...open].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))[0];
  });

  constructor() {
    // Persist on every task change. Reads `_tasks()` so it re-runs when tasks move.
    effect(() => {
      const snapshot = this._tasks();
      this.save(snapshot);
    });
  }

  // ---- Lifecycle ----------------------------------------------------------

  /** Loads from localStorage if present, otherwise from the API seed. */
  load(): void {
    const cached = this.readStorage();
    if (cached && cached.length > 0) {
      this._tasks.set(cached);
      return;
    }
    this._loading.set(true);
    this.api.load().subscribe((tasks) => {
      this._tasks.set(tasks);
      this._loading.set(false);
      this.notify.push(`Loaded ${tasks.length} tasks`, 'success');
    });
  }

  // ---- Commands -----------------------------------------------------------

  add(input: NewTask): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: this.nextId(),
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      status: input.status ?? TaskStatus.Todo,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      createdAt: now,
      updatedAt: now,
      tags: input.tags ?? [],
    };
    this.mutate((list) => [...list, task]);
    this.notify.push(`Added "${task.title}"`, 'success');
    return task;
  }

  update(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): void {
    this.mutate((list) =>
      list.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)),
    );
  }

  remove(id: string): void {
    const victim = this.byId(id);
    this.mutate((list) => list.filter((t) => t.id !== id));
    if (victim) this.notify.push(`Removed "${victim.title}"`, 'info');
  }

  toggleDone(id: string): void {
    const task = this.byId(id);
    if (!task) return;
    const next = task.status === TaskStatus.Done ? TaskStatus.Todo : TaskStatus.Done;
    this.update(id, { status: next });
  }

  setStatus(id: string, status: TaskStatus): void {
    this.update(id, { status });
  }

  setPriority(id: string, priority: Priority): void {
    this.update(id, { priority });
  }

  // ---- Filter + sort ------------------------------------------------------

  /** Replaces the whole filter. */
  setFilter(filter: TaskFilter): void {
    this._filter = { ...filter };
  }

  /** Patches one field of the filter. */
  patchFilter(patch: Partial<TaskFilter>): void {
    this._filter = { ...this._filter, ...patch };
  }

  filter(): TaskFilter {
    return this._filter;
  }

  resetFilter(): void {
    this._filter = { ...DEFAULT_FILTER };
  }

  setSort(sort: SortSpec): void {
    this._sort.set({ ...sort });
  }

  toggleSortDir(): void {
    this._sort.update((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }));
  }

  // ---- Undo + reset -------------------------------------------------------

  undo(): void {
    const stack = this._undo();
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    this._undo.set(stack.slice(0, -1));
    this._tasks.set(previous);
    this.notify.push('Undid last change', 'info');
  }

  /** Empties every task and the undo stack. Distinct from NotificationService.clear(). */
  clear(): void {
    this.pushUndo();
    this._tasks.set([]);
  }

  // ---- Import / export ----------------------------------------------------

  exportJson(): string {
    return JSON.stringify(this._tasks(), null, 2);
  }

  importJson(json: string): number {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      this.notify.push('Import failed: invalid JSON', 'error');
      return 0;
    }
    if (!Array.isArray(parsed)) {
      this.notify.push('Import failed: expected an array', 'error');
      return 0;
    }
    const tasks = parsed.filter((t): t is Task => this.looksLikeTask(t));
    this.mutate(() => tasks);
    this.notify.push(`Imported ${tasks.length} tasks`, 'success');
    return tasks.length;
  }

  // ---- Lookups ------------------------------------------------------------

  byId(id: string): Task | undefined {
    return this._tasks().find((t) => t.id === id);
  }

  byStatus(status: TaskStatus): Task[] {
    return this._tasks().filter((t) => t.status === status);
  }

  // ---- Bulk operations ----------------------------------------------------

  /** Marks every not-Done task as Done in a single undoable step. */
  markAllDone(): void {
    const now = new Date().toISOString();
    this.mutate((list) =>
      list.map((t) => (t.status === TaskStatus.Done ? t : { ...t, status: TaskStatus.Done, updatedAt: now })),
    );
    this.notify.push('Marked all done', 'success');
  }

  /** Drops every Done task; returns how many were removed. */
  removeCompleted(): number {
    const before = this._tasks().length;
    this.mutate((list) => list.filter((t) => t.status !== TaskStatus.Done));
    const removed = before - this._tasks().length;
    if (removed > 0) this.notify.push(`Cleared ${removed} completed`, 'info');
    return removed;
  }

  /** Copies a task (new id, reset timestamps) and appends it. */
  duplicate(id: string): Task | undefined {
    const source = this.byId(id);
    if (!source) return undefined;
    const now = new Date().toISOString();
    const copy: Task = {
      ...source,
      id: this.nextId(),
      title: `${source.title} (copy)`,
      status: TaskStatus.Todo,
      createdAt: now,
      updatedAt: now,
      tags: [...source.tags],
    };
    this.mutate((list) => [...list, copy]);
    return copy;
  }

  // ---- Tag management -----------------------------------------------------

  addTag(id: string, tag: string): void {
    const clean = tag.trim().toLowerCase();
    if (!clean) return;
    const task = this.byId(id);
    if (!task || task.tags.includes(clean)) return;
    this.update(id, { tags: [...task.tags, clean] });
  }

  removeTag(id: string, tag: string): void {
    const task = this.byId(id);
    if (!task) return;
    this.update(id, { tags: task.tags.filter((t) => t !== tag) });
  }

  /** Every distinct tag in use, alphabetically. */
  allTags(): string[] {
    const set = new Set<string>();
    for (const t of this._tasks()) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  }

  /** A short human summary of the current board, used in toasts and the title. */
  summary(): string {
    const s = this.stats();
    return `${s.total} tasks - ${s.byStatus[TaskStatus.Done]} done, ${s.overdue} overdue`;
  }

  // ---- Internals ----------------------------------------------------------

  private applyFilter(tasks: readonly Task[], filter: TaskFilter): Task[] {
    const needle = filter.text.trim().toLowerCase();
    const today = todayIso();
    return tasks.filter((t) => {
      if (filter.status !== 'all' && t.status !== filter.status) return false;
      if (filter.priority !== 'all' && t.priority !== filter.priority) return false;
      if (filter.overdueOnly && !isOverdue(t, today)) return false;
      if (needle) {
        const haystack = `${t.title} ${t.description}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  private computeStats(tasks: readonly Task[]): TaskStats {
    const byStatus: Record<TaskStatus, number> = {
      [TaskStatus.Todo]: 0,
      [TaskStatus.Active]: 0,
      [TaskStatus.Blocked]: 0,
      [TaskStatus.Done]: 0,
    };
    const byPriority: Record<Priority, number> = {
      [Priority.Low]: 0,
      [Priority.Medium]: 0,
      [Priority.High]: 0,
      [Priority.Critical]: 0,
    };
    const today = todayIso();
    let overdue = 0;
    for (const t of tasks) {
      byStatus[t.status]++;
      byPriority[t.priority]++;
      if (isOverdue(t, today)) overdue++;
    }
    const total = tasks.length;
    const done = byStatus[TaskStatus.Done];
    const completionRate = total === 0 ? 0 : done / (total - done);
    return { total, byStatus, byPriority, overdue, completionRate };
  }

  private mutate(fn: (list: Task[]) => Task[]): void {
    this.pushUndo();
    this._tasks.update((list) => fn(list));
  }

  private pushUndo(): void {
    this._undo.update((stack) => {
      const next = [...stack, this._tasks()];
      return next.length > MAX_UNDO ? next.slice(next.length - MAX_UNDO) : next;
    });
  }

  private nextId(): string {
    return `t-${Math.random().toString(36).slice(2, 10)}`;
  }

  private looksLikeTask(value: unknown): value is Task {
    if (!value || typeof value !== 'object') return false;
    const t = value as Record<string, unknown>;
    return typeof t['id'] === 'string' && typeof t['title'] === 'string';
  }

  private save(tasks: Task[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // storage full or unavailable - non-fatal
    }
  }

  private readStorage(): Task[] | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
