import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('retrieves all users', () => {
    service.getUsers().subscribe(users => {
      expect(users.length).toBe(2);
    });

    const req = httpMock.expectOne('http://localhost:3000/api/users');
    expect(req.request.method).toBe('GET');
    req.flush([
      { id: 'u1', username: 'alpha', email: 'a@example.com' },
      { id: 'u2', username: 'beta', email: 'b@example.com' }
    ]);
  });

  it('creates a user with roles and groups payload', () => {
    service.createUser({ username: 'new', email: 'n@example.com', password: 'pwd', roles: ['user'], groups: [] }).subscribe(res => {
      expect(res.success).toBeTrue();
    });

    const req = httpMock.expectOne('http://localhost:3000/api/users');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.username).toBe('new');
    req.flush({ success: true, user: { id: 'u1' } });
  });

  it('fetches a single user by id', () => {
    service.getUser('u123').subscribe(user => {
      expect(user.id).toBe('u123');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/users/u123');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 'u123', username: 'someone', email: 's@example.com' });
  });

  it('updates user details', () => {
    service.updateUser('u4', { username: 'updated' }).subscribe(user => {
      expect(user.username).toBe('updated');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/users/u4');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ username: 'updated' });
    req.flush({ id: 'u4', username: 'updated', email: 'u4@example.com' });
  });

  it('deletes a user by id', () => {
    service.deleteUser('u1').subscribe(() => {
      expect(true).toBeTrue();
    });

    const req = httpMock.expectOne('http://localhost:3000/api/users/u1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true });
  });

  it('promotes a user to group admin', () => {
    service.promoteToGroupAdmin('u9').subscribe(user => {
      expect(user.id).toBe('u9');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/users/u9/promote');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ id: 'u9', username: 'admin' });
  });
});
