import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DashboardComponent } from './dashboard.component';
import { TaskFormComponent } from './task-form.component';
import { TaskListComponent } from './task-list.component';

/** The '/' route: dashboard, add-task form, and the filterable list stacked together. */
@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardComponent, TaskFormComponent, TaskListComponent],
  template: `
    <app-dashboard />
    <app-task-form />
    <app-task-list />
  `,
})
export class HomeComponent {}
