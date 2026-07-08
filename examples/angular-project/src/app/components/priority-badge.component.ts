import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Priority } from '../models/task.model';
import { PriorityLabelPipe } from '../pipes/priority-label.pipe';

/** Small colored badge showing a task's priority; label text always shown, not colour-only. */
@Component({
  selector: 'app-priority-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PriorityLabelPipe],
  template: ` <span class="priority-badge" [attr.data-priority]="priority()">{{ priority() | priorityLabel }}</span> `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .priority-badge {
        display: inline-block;
        padding: 0.1rem 0.5rem;
        border-radius: 1rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: #fff;
        background: #7f8c8d;
      }
      .priority-badge[data-priority='low'] {
        background: #27ae60;
      }
      .priority-badge[data-priority='medium'] {
        background: #f39c12;
      }
      .priority-badge[data-priority='high'] {
        background: #e67e22;
      }
      .priority-badge[data-priority='critical'] {
        background: #c0392b;
      }
    `,
  ],
})
export class PriorityBadgeComponent {
  readonly priority = input.required<Priority>();
}
