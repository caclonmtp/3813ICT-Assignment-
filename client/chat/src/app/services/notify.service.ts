import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastType = 'success' | 'error' | 'info';
export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class NotifyService {
  private toastsSubject = new BehaviorSubject<Toast[]>([]);
  toasts$ = this.toastsSubject.asObservable();

  private genId() {
    return Math.random().toString(36).slice(2, 10);
  }

  private push(type: ToastType, message: string, duration = 3000) {
    const toast: Toast = { id: this.genId(), type, message };
    const current = this.toastsSubject.getValue();
    this.toastsSubject.next([...current, toast]);
    setTimeout(() => this.dismiss(toast.id), duration);
  }

  success(message: string) { this.push('success', message); }
  error(message: string) { this.push('error', message, 4000); }
  info(message: string) { this.push('info', message); }

  dismiss(id: string) {
    const next = this.toastsSubject.getValue().filter(t => t.id !== id);
    this.toastsSubject.next(next);
  }
}

