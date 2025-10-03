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

  // Presents the confirm dialog and resolves once the user responds.
  ask(message: string, title?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.stateSubject.next({ message, title, resolve });
    });
  }

  // Accepts the pending confirmation prompt, resolving the awaiting promise.
  accept() {
    const st = this.stateSubject.getValue();
    st?.resolve?.(true);
    this.stateSubject.next(null);
  }

  // Cancels the confirmation prompt.
  cancel() {
    const st = this.stateSubject.getValue();
    st?.resolve?.(false);
    this.stateSubject.next(null);
  }
}
