import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    window.localStorage.clear();
    service = new StorageService();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('stores and retrieves values', () => {
    service.setItem('theme', 'dark');
    expect(service.getItem('theme')).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });

  it('removes single keys and can clear everything', () => {
    service.setItem('token', 'abc');
    service.removeItem('token');
    expect(service.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('token')).toBeNull();

    service.setItem('a', '1');
    service.setItem('b', '2');
    service.clear();
    expect(window.localStorage.length).toBe(0);
  });
});
