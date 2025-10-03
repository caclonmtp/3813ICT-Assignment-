import { fakeAsync, tick } from '@angular/core/testing';
import { NotifyService, Toast } from './notify.service';

describe('NotifyService', () => {
  let service: NotifyService;
  let latest: Toast[];
  let subscription: { unsubscribe(): void };

  beforeEach(() => {
    service = new NotifyService();
    latest = [];
    subscription = service.toasts$.subscribe(toasts => {
      latest = toasts;
    });
  });

  afterEach(() => {
    subscription.unsubscribe();
  });

  it('pushes success toast and clears it after duration', fakeAsync(() => {
    service.success('Saved');
    expect(latest.length).toBe(1);
    expect(latest[0].type).toBe('success');

    tick(3000);
    expect(latest.length).toBe(0);
  }));

  it('dismiss removes a toast immediately', () => {
    service.info('Heads up');
    const id = latest[0].id;
    service.dismiss(id);
    expect(latest.length).toBe(0);
  });
});
