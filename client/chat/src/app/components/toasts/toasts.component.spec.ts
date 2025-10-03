import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { ToastsComponent } from './toasts.component';
import { NotifyService, Toast } from '../../services/notify.service';

describe('ToastsComponent', () => {
  let fixture: ComponentFixture<ToastsComponent>;
  let component: ToastsComponent;
  let subject: BehaviorSubject<Toast[]>;
  let notifySpy: jasmine.SpyObj<NotifyService>;

  beforeEach(async () => {
    subject = new BehaviorSubject<Toast[]>([]);
    notifySpy = jasmine.createSpyObj<NotifyService>('NotifyService', ['dismiss'], { toasts$: subject.asObservable() });

    await TestBed.configureTestingModule({
      imports: [ToastsComponent],
      providers: [{ provide: NotifyService, useValue: notifySpy }]
    }).compileComponents();

    fixture = TestBed.createComponent(ToastsComponent);
    component = fixture.componentInstance;
  });

  it('renders toasts from the service and dismisses them on click', () => {
    subject.next([
      { id: '1', type: 'success', message: 'Saved!' }
    ]);

    fixture.detectChanges();
    const compiled: HTMLElement = fixture.nativeElement;
    const toastElements = compiled.querySelectorAll('.toast');
    expect(toastElements.length).toBe(1);
    expect(toastElements[0].textContent).toContain('Saved!');

    component.dismiss('1');
    expect(notifySpy.dismiss).toHaveBeenCalledWith('1');
  });
});
