import { skip, take } from 'rxjs/operators';
import { ConfirmService } from './confirm.service';

describe('ConfirmService', () => {
  let service: ConfirmService;

  beforeEach(() => {
    service = new ConfirmService();
  });

  it('emits state when asking and resolves when accepted', async () => {
    const states: any[] = [];
    const sub = service.state$.pipe(skip(1), take(1)).subscribe(state => states.push(state));

    const promise = service.ask('Proceed?', 'Confirm');
    service.accept();
    const result = await promise;

    expect(result).toBeTrue();
    expect(states.length).toBe(1);
    expect(states[0]?.message).toBe('Proceed?');
    sub.unsubscribe();
  });

  it('resolves false when cancelled', async () => {
    const promise = service.ask('Cancel me');
    service.cancel();
    const result = await promise;
    expect(result).toBeFalse();
  });
});
