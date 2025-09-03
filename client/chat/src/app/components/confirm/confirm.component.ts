import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService, ConfirmState } from '../../services/confirm.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-confirm',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm.component.html',
  styleUrls: ['./confirm.component.css']
})
export class ConfirmComponent {
  state$: Observable<ConfirmState | null>;
  constructor(private confirm: ConfirmService) {
    this.state$ = this.confirm.state$;
  }

  @HostListener('document:keydown.escape') onEsc() { this.confirm.cancel(); }
  accept() { this.confirm.accept(); }
  cancel() { this.confirm.cancel(); }
}
