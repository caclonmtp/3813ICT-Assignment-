import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';
import { User } from '../models/user.model';

class MockStorageService {
  private store = new Map<string, string>();

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let storage: MockStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: StorageService, useClass: MockStorageService }]
    });

    storage = TestBed.inject(StorageService) as unknown as MockStorageService;
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('stores the current user after successful login', () => {
    const responseUser: User = { id: 'u1', username: 'alice', email: 'a@b.test', roles: ['user'], groups: [] };

    service.login('alice', 'secret').subscribe(result => {
      expect(result.success).toBeTrue();
      expect(service.currentUserValue?.id).toBe('u1');
      expect(storage.getItem('currentUser')).toContain('alice');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/auth/login');
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, user: responseUser });
  });

  it('does not mutate state when login fails', () => {
    service.login('alice', 'bad').subscribe(result => {
      expect(result.success).toBeFalse();
    });

    const req = httpMock.expectOne('http://localhost:3000/api/auth/login');
    expect(req.request.method).toBe('POST');
    req.flush({ success: false, message: 'Invalid credentials' });

    expect(storage.getItem('currentUser')).toBeNull();
    expect(service.currentUserValue).toBeNull();
  });

  it('register hits the expected endpoint', () => {
    service.register('bob', 'bob@example.com', 'secret').subscribe(result => {
      expect(result.success).toBeTrue();
    });

    const req = httpMock.expectOne('http://localhost:3000/api/auth/register');
    expect(req.request.method).toBe('POST');
    req.flush({ success: true });
  });

  it('logout clears stored user', () => {
    storage.setItem('currentUser', JSON.stringify({ id: 'x' }));
    service.logout();
    expect(storage.getItem('currentUser')).toBeNull();
    expect(service.currentUserValue).toBeNull();
  });

  it('mergeCurrentUser updates stored state', () => {
    const initial: User = { id: 'u2', username: 'admin', email: 'admin@example.com', roles: ['super-admin'], groups: [] };
    storage.setItem('currentUser', JSON.stringify(initial));
    service.setCurrentUser(initial);

    const updated = service.mergeCurrentUser({ email: 'new@example.com' });
    expect(updated?.email).toBe('new@example.com');
    expect(storage.getItem('currentUser')).toContain('new@example.com');
    expect(service.isSuperAdmin()).toBeTrue();
  });

  it('returns null when mergeCurrentUser is called without an active user', () => {
    const updated = service.mergeCurrentUser({ email: 'nobody@example.com' });
    expect(updated).toBeNull();
    expect(storage.getItem('currentUser')).toBeNull();
  });

  it('ignores attempts to set an empty current user', () => {
    service.setCurrentUser(undefined as unknown as User);
    expect(storage.getItem('currentUser')).toBeNull();
    expect(service.currentUserValue).toBeNull();
  });

  it('reports admin capabilities based on roles', () => {
    expect(service.isSuperAdmin()).toBeFalse();
    expect(service.isGroupAdmin()).toBeFalse();

    const groupAdmin: User = {
      id: 'u10',
      username: 'groupAdmin',
      email: 'group@admin.test',
      roles: ['group-admin'],
      groups: []
    };
    service.setCurrentUser(groupAdmin);
    expect(service.isGroupAdmin()).toBeTrue();
    expect(service.isSuperAdmin()).toBeFalse();

    const superAdmin: User = { ...groupAdmin, roles: ['super-admin'] };
    service.setCurrentUser(superAdmin);
    expect(service.isSuperAdmin()).toBeTrue();
    expect(service.isGroupAdmin()).toBeTrue();
  });

  it('restores a persisted user from storage during construction', () => {
    const storedUser: User = {
      id: 'u11',
      username: 'persisted',
      email: 'persisted@example.com',
      roles: ['user'],
      groups: []
    };
    storage.setItem('currentUser', JSON.stringify(storedUser));

    const httpClient = TestBed.inject(HttpClient);
    const freshService = new AuthService(httpClient, storage as unknown as StorageService);

    expect(freshService.currentUserValue).toEqual(storedUser);
  });
});
