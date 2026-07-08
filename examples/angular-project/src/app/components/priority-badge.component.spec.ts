import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Priority } from '../models/task.model';
import { PriorityBadgeComponent } from './priority-badge.component';

describe('PriorityBadgeComponent', () => {
  let fixture: ComponentFixture<PriorityBadgeComponent>;

  async function setup(priority: Priority): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [PriorityBadgeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PriorityBadgeComponent);
    fixture.componentRef.setInput('priority', priority);
    fixture.detectChanges();
  }

  it('renders the label for a given priority', async () => {
    await setup(Priority.High);

    const badge = fixture.nativeElement.querySelector('.priority-badge');
    expect(badge.textContent.trim()).toBe('High');
    expect(badge.getAttribute('data-priority')).toBe('high');
  });

  it('is OnPush', () => {
    // ɵcmp.onPush is Angular's own component-definition flag; the documented way to assert
    // the change-detection strategy without triggering a live CD cycle to prove it indirectly.
    expect((PriorityBadgeComponent as unknown as { ɵcmp: { onPush: boolean } }).ɵcmp.onPush).toBe(true);
  });
});
