import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SessionService } from '../services/session.service';

@Component({
selector: 'app-login',
standalone: true,
imports: [CommonModule, FormsModule],
templateUrl: './login.component.html'
})
export class LoginComponent {
username = '';
password = '';
message = '';

constructor(private session: SessionService, private router: Router) {}

doLogin() {
const r = this.session.login(this.username.trim(), this.password.trim());
if (!r.ok) { this.message = r.error || 'Login failed'; return; }
this.router.navigate(['/groups']);
}

doRegister() {
const r = this.session.register(this.username.trim());
this.message = r.ok ? 'Registered. Now set a password convention for yourself (not stored in Phase‑1).' : (r.error || 'Register failed');
}
}