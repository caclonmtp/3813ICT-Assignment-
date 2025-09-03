import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ToastsComponent } from './components/toasts/toasts.component';
import { ConfirmComponent } from './components/confirm/confirm.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, ToastsComponent, ConfirmComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {}
