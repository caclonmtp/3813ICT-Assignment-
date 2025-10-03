import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { ConfirmComponent } from './confirm.component';
import { ConfirmService, ConfirmState } from '../../services/confirm.service';

describe('ConfirmComponent', () => {
  let fixture: ComponentFixture<ConfirmComponent>;
  let component: ConfirmComponent;
  let subject: BehaviorSubject<ConfirmState | null>;
  let confirmSpy: jasmine.SpyObj<ConfirmService>;

  beforeEach(async () => {
    subject = new BehaviorSubject<ConfirmState | null>(null);
    confirmSpy = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['accept', 'cancel'], {
      state$: subject.asObservable()
    });

    await TestBed.configureTestingModule({
      imports: [ConfirmComponent],
      providers: [{ provide: ConfirmService, useValue: confirmSpy }]
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmComponent);
    component = fixture.componentInstance;
  });

  it('renders the confirmation message and delegates actions to the service', () => {
    subject.next({ message: 'Are you sure?', title: 'Confirm action' });
    fixture.detectChanges();

    const compiled: HTMLElement = fixture.nativeElement;
    expect(compiled.querySelector('.confirm-message')?.textContent).toContain('Are you sure?');

    component.accept();
    expect(confirmSpy.accept).toHaveBeenCalled();

    component.cancel();
    expect(confirmSpy.cancel).toHaveBeenCalled();
  });
});
