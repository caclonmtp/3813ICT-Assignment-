import { ComponentFixture, TestBed, fakeAsync } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import { NotifyService } from '../../services/notify.service';
import { Router } from '@angular/router';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let notifySpy: jasmine.SpyObj<NotifyService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['login', 'register']);
    notifySpy = jasmine.createSpyObj<NotifyService>('NotifyService', ['success', 'error']);
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: NotifyService, useValue: notifySpy },
        { provide: Router, useValue: routerSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not attempt login when form is invalid', () => {
    component.onLogin();
    expect(authServiceSpy.login).not.toHaveBeenCalled();
  });

  it('logs in successfully and navigates to dashboard', fakeAsync(() => {
    authServiceSpy.login.and.returnValue(of({ success: true }));
    component.loginForm.setValue({ username: 'alice', password: 'secret' });

    component.onLogin();

    expect(authServiceSpy.login).toHaveBeenCalled();
    expect(notifySpy.success).toHaveBeenCalledWith('Logged in successfully');
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  }));

  it('displays an error when login fails', () => {
    authServiceSpy.login.and.returnValue(throwError(() => ({ error: { message: 'Bad credentials' } })));
    component.loginForm.setValue({ username: 'eve', password: 'wrong' });

    component.onLogin();

    expect(component.error).toBe('Bad credentials');
    expect(notifySpy.error).toHaveBeenCalledWith('Bad credentials');
  });

  it('surfaces registration errors from the service', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ error: { message: 'Registration failed' } })));
    component.registerForm.setValue({ username: 'bob', email: 'bob@example.com', password: 'pw' });

    component.onRegister();

    expect(authServiceSpy.register).toHaveBeenCalled();
    expect(notifySpy.error).toHaveBeenCalledWith('Registration failed');
    expect(component.error).toBe('Registration failed');
  });

  it('registers successfully and resets both forms', () => {
    authServiceSpy.register.and.returnValue(of({ success: true }));
    component.isRegistering = true;
    component.registerForm.setValue({ username: 'carol', email: 'carol@example.com', password: 'pw' });
    component.loginForm.setValue({ username: 'existing', password: 'pw' });

    component.onRegister();

    expect(authServiceSpy.register).toHaveBeenCalled();
    expect(component.isRegistering).toBeFalse();
    expect(component.registerForm.value).toEqual({ username: null, email: null, password: null });
    expect(component.loginForm.value).toEqual({ username: null, password: null });
    expect(component.error).toBe('');
    expect(notifySpy.success).toHaveBeenCalledWith('Registration successful. Please log in.');
  });

  it('does not attempt register when form is invalid', () => {
    component.onRegister();
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('toggles between login and register modes', () => {
    expect(component.isRegistering).toBeFalse();
    component.toggleMode();
    expect(component.isRegistering).toBeTrue();
    component.toggleMode();
    expect(component.isRegistering).toBeFalse();
  });

  it('switchToLogin only reacts when currently registering', () => {
    component.isRegistering = true;
    component.error = 'Something bad';
    component.switchToLogin();

    expect(component.isRegistering).toBeFalse();
    expect(component.error).toBe('');
  });

  it('switchToRegister only reacts when not already registering', () => {
    component.error = 'Another error';
    component.switchToRegister();

    expect(component.isRegistering).toBeTrue();
    expect(component.error).toBe('');
  });
});
