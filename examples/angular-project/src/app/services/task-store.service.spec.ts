import { TestBed } from '@angular/core/testing';
import { Priority, TaskStatus } from '../models/task.model';
import { TaskStore } from './task-store.service';

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(TaskStore);
  });

  it('starts empty', () => {
    expect(store.tasks().length).toBe(0);
    expect(store.visibleTasks().length).toBe(0);
  });

  it('adds a task and reflects it in the visible list (default filter = all)', () => {
    store.add({ title: 'Write tests', description: 'unit', priority: Priority.High });
    expect(store.tasks().length).toBe(1);
    expect(store.visibleTasks().length).toBe(1);
    expect(store.visibleTasks()[0].title).toBe('Write tests');
    expect(store.visibleTasks()[0].status).toBe(TaskStatus.Todo);
  });

  it('toggleDone flips Todo <-> Done', () => {
    const t = store.add({ title: 'Ship', description: '', priority: Priority.Low });
    store.toggleDone(t.id);
    expect(store.byId(t.id)?.status).toBe(TaskStatus.Done);
    store.toggleDone(t.id);
    expect(store.byId(t.id)?.status).toBe(TaskStatus.Todo);
  });

  it('remove deletes by id', () => {
    const t = store.add({ title: 'Temp', description: '', priority: Priority.Low });
    store.remove(t.id);
    expect(store.byId(t.id)).toBeUndefined();
    expect(store.tasks().length).toBe(0);
  });

  it('undo restores the previous snapshot', () => {
    const t = store.add({ title: 'Keep', description: '', priority: Priority.Medium });
    store.remove(t.id);
    expect(store.tasks().length).toBe(0);
    store.undo();
    expect(store.tasks().length).toBe(1);
    expect(store.byId(t.id)?.title).toBe('Keep');
  });

  it('stats count totals and per-status buckets', () => {
    store.add({ title: 'a', description: '', priority: Priority.Low, status: TaskStatus.Todo });
    store.add({ title: 'b', description: '', priority: Priority.High, status: TaskStatus.Done });
    store.add({ title: 'c', description: '', priority: Priority.High, status: TaskStatus.Active });
    const stats = store.stats();
    expect(stats.total).toBe(3);
    expect(stats.byStatus[TaskStatus.Done]).toBe(1);
    expect(stats.byStatus[TaskStatus.Active]).toBe(1);
    expect(stats.byStatus[TaskStatus.Todo]).toBe(1);
    expect(stats.byPriority[Priority.High]).toBe(2);
  });

  it('export then import round-trips the task set', () => {
    store.add({ title: 'x', description: 'desc', priority: Priority.Critical });
    const json = store.exportJson();
    store.clear();
    expect(store.tasks().length).toBe(0);
    const n = store.importJson(json);
    expect(n).toBe(1);
    expect(store.tasks()[0].title).toBe('x');
  });
});
