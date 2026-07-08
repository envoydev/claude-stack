import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { NotificationService } from './services/notification.service';
import { TaskStore } from './services/task-store.service';

/** App shell: title bar, global toast stack, and the routed outlet. */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="app-header">
      <a routerLink="/" class="brand">Task Playground</a>
    </header>

    <main class="app-main">
      <router-outlet />
    </main>

    <div class="toasts" aria-live="polite">
      @for (toast of notify.toasts(); track toast.id) {
        <div class="toast" [class]="toast.kind" (click)="notify.dismiss(toast.id)">{{ toast.text }}</div>
      }
    </div>
  `,
  styles: [
    `
      .app-header { display: flex; padding: 0.75rem 1rem; border-bottom: 1px solid #eee; }
      .brand { font-weight: 700; text-decoration: none; color: inherit; }
      .app-main { padding: 1rem; max-width: 60rem; margin: 0 auto; }
      .toasts { position: fixed; bottom: 1rem; right: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
      .toast { padding: 0.5rem 0.75rem; border-radius: 6px; color: #fff; cursor: pointer; }
      .toast.info { background: #34495e; }
      .toast.success { background: #27ae60; }
      .toast.error { background: #c0392b; }
    `,
  ],
})
export class AppComponent implements OnInit {
  protected readonly store = inject(TaskStore);
  protected readonly notify = inject(NotificationService);
  readonly title = 'angular-project';

  ngOnInit(): void {
    this.store.load();
  }
}
