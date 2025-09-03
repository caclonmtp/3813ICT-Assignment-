import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotifyService, Toast } from '../../services/notify.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-toasts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toasts.component.html',
  styleUrls: ['./toasts.component.css']
})
export class ToastsComponent {
  toasts$: Observable<Toast[]>;
  constructor(private notify: NotifyService) {
    this.toasts$ = this.notify.toasts$;
  }
  dismiss(id: string) { this.notify.dismiss(id); }
}
