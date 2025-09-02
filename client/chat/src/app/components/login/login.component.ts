import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-login',
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

    onLogin(): void {
        if (this.loginForm.invalid) {
            return;
        }

        const { username, password } = this.loginForm.value;
        this.authService.login(username, password).subscribe({
            next: (response) => {
                if (response.success) {
                    this.router.navigate(['/dashboard']);
                }
            },
            error: (error) => {
                this.error = error.error.message || 'Login failed';
            }
        });
    }

    onRegister(): void {
        if (this.registerForm.invalid) {
            return;
        }

        const { username, email, password } = this.registerForm.value;
        this.authService.register(username, email, password).subscribe({
            next: (response) => {
                if (response.success) {
                    this.router.navigate(['/dashboard']);
                }
            },
            error: (error) => {
                this.error = error.error.message || 'Registration failed';
            }
        });
    }

    toggleMode(): void {
        this.isRegistering = !this.isRegistering;
        this.error = '';
    }
}