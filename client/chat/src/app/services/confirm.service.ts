import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ConfirmState {
  title?: string;
  message: string;
  resolve?: (ok: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private stateSubject = new BehaviorSubject<ConfirmState | null>(null);
  state$ = this.stateSubject.asObservable();

  ask(message: string, title?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.stateSubject.next({ message, title, resolve });
    });
  }

  accept() {
    const st = this.stateSubject.getValue();
    st?.resolve?.(true);
    this.stateSubject.next(null);
  }

  cancel() {
    const st = this.stateSubject.getValue();
    st?.resolve?.(false);
    this.stateSubject.next(null);
  }
}

