import { Routes } from '@angular/router';
import { HomeComponent } from './components/home.component';
import { TaskDetailComponent } from './components/task-detail.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'Tasks' },
  { path: 'task/:id', component: TaskDetailComponent, title: 'Task detail' },
  { path: '**', redirectTo: '' },
];
