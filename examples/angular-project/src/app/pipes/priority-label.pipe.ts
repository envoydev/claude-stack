import { Pipe, PipeTransform } from '@angular/core';
import { Priority, PRIORITY_LABELS } from '../models/task.model';

/** Maps a Priority enum value to its human label; used across the item + detail views. */
@Pipe({ name: 'priorityLabel', standalone: true })
export class PriorityLabelPipe implements PipeTransform {
  transform(value: Priority): string {
    return PRIORITY_LABELS[value] ?? value;
  }
}
