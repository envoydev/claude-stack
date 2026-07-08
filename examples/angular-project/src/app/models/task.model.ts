/**
 * Core domain model for the task tracker.
 *
 * These types are the shared vocabulary of the app - the store, the components,
 * the pipes and the utils all import from here, so this file is referenced from
 * many sites. `TaskStatus` in particular is a deliberately grep-noisy name (the
 * string 'active' also appears in filters and templates) to contrast a semantic
 * find_referencing_symbols against a plain text grep.
 */

export enum TaskStatus {
  Todo = 'todo',
  Active = 'active',
  Blocked = 'blocked',
  Done = 'done',
}

export enum Priority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  /** ISO date string (yyyy-mm-dd) or null when the task has no deadline. */
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** Free-form labels, surfaced in the item row. */
  tags: string[];
}

/** A partial payload accepted when creating a task; the store fills the rest. */
export type NewTask = Pick<Task, 'title' | 'description' | 'priority'> &
  Partial<Pick<Task, 'dueDate' | 'tags' | 'status'>>;

/** The set of predicates the list view can filter by. */
export interface TaskFilter {
  status: TaskStatus | 'all';
  priority: Priority | 'all';
  /** Case-insensitive substring match against title + description. */
  text: string;
  /** When true, only tasks whose dueDate is in the past and not Done. */
  overdueOnly: boolean;
}

export type SortKey = 'priority' | 'dueDate' | 'title' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}

/** Aggregate figures shown on the dashboard. */
export interface TaskStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<Priority, number>;
  overdue: number;
  /** Fraction 0..1 of tasks that are Done. */
  completionRate: number;
}

export const DEFAULT_FILTER: TaskFilter = {
  status: 'all',
  priority: 'all',
  text: '',
  overdueOnly: false,
};

export const DEFAULT_SORT: SortSpec = { key: 'priority', dir: 'desc' };

/** Human-facing labels, kept beside the enums so both stay in step. */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.Todo]: 'To do',
  [TaskStatus.Active]: 'Active',
  [TaskStatus.Blocked]: 'Blocked',
  [TaskStatus.Done]: 'Done',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.Low]: 'Low',
  [Priority.Medium]: 'Medium',
  [Priority.High]: 'High',
  [Priority.Critical]: 'Critical',
};

export function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return typeof t['id'] === 'string' && typeof t['title'] === 'string' && typeof t['status'] === 'string';
}
