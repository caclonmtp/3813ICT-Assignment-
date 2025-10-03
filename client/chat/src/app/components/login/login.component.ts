import { Component } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { NotifyService } from '../../services/notify.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactiveFormsModule],
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.css']
})
export class LoginComponent {
    loginForm: FormGroup;
    registerForm: FormGroup;
    isRegistering = false;
    error = '';

    constructor(
        private formBuilder: FormBuilder,
        private authService: AuthService,
        private notify: NotifyService,
        private router: Router
    ) {
        this.loginForm = this.formBuilder.group({
            username: ['', Validators.required],
            password: ['', Validators.required]
        });

        this.registerForm = this.formBuilder.group({
            username: ['', Validators.required],
            email: ['', [Validators.required, Validators.email]],
            password: ['', Validators.required]
        });
    }

    // Handles login form submission and navigates on success.
    onLogin(): void {
        if (this.loginForm.invalid) {
            return;
        }

        const { username, password } = this.loginForm.value;
        this.authService.login(username, password).subscribe({
            next: (response) => {
                if (response.success) {
                    this.notify.success('Logged in successfully');
                    this.router.navigate(['/dashboard']);
                }
            },
            error: (error) => {
                this.error = error.error.message || 'Login failed';
                this.notify.error(this.error);
            }
        });
    }

    // Handles registration form submission and resets UI on success.
    onRegister(): void {
        if (this.registerForm.invalid) {
            return;
        }

        const { username, email, password } = this.registerForm.value;
        this.authService.register(username, email, password).subscribe({
            next: (response) => {
                if (response.success) {
                    // After successful registration, switch back to login form
                    this.isRegistering = false;
                    this.registerForm.reset();
                    this.loginForm.reset();
                    // Optional: brief success notice
                    this.error = '';
                    this.notify.success('Registration successful. Please log in.');
                }
            },
            error: (error) => {
                this.error = error.error.message || 'Registration failed';
                this.notify.error(this.error);
            }
        });
    }

    // Switches between login and registration forms.
    toggleMode(): void {
        this.isRegistering = !this.isRegistering;
        this.error = '';
    }

    // Explicitly returns the UI to the login form.
    switchToLogin(): void {
        if (this.isRegistering) {
            this.isRegistering = false;
            this.error = '';
        }
    }

    // Explicitly switches the UI to the registration form.
    switchToRegister(): void {
        if (!this.isRegistering) {
            this.isRegistering = true;
            this.error = '';
        }
    }
}
