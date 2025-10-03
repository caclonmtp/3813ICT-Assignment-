import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { GroupService } from './group.service';

describe('GroupService', () => {
  let service: GroupService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(GroupService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches groups for the current user', () => {
    service.getGroups().subscribe(groups => {
      expect(groups.length).toBe(1);
      expect(groups[0].name).toBe('Team');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/groups');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'g1', name: 'Team', createdBy: 'u1', admins: [], members: [], createdAt: Date.now() }]);
  });

  it('fetches groups scoped to a user id', () => {
    service.getUserGroups('u1').subscribe();

    const req = httpMock.expectOne('http://localhost:3000/api/groups/user/u1');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('creates a group with the provided payload', () => {
    service.createGroup('Project', 'owner').subscribe(group => {
      expect(group.name).toBe('Project');
      expect(group.createdBy).toBe('owner');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/groups');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Project', createdBy: 'owner' });
    req.flush({ id: 'g2', name: 'Project', createdBy: 'owner', admins: [], members: [], createdAt: Date.now() });
  });

  it('adds a user to a group', () => {
    service.addUserToGroup('g1', 'u2').subscribe(group => {
      expect(group.id).toBe('g1');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/groups/g1/members');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 'u2' });
    req.flush({ id: 'g1' });
  });

  it('removes a user from a group', () => {
    service.removeUserFromGroup('g1', 'u2').subscribe(group => {
      expect(group.id).toBe('g1');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/groups/g1/members/u2');
    expect(req.request.method).toBe('DELETE');
    req.flush({ id: 'g1' });
  });

  it('deletes a group by id', () => {
    service.deleteGroup('g1').subscribe();

    const req = httpMock.expectOne('http://localhost:3000/api/groups/g1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true });
  });

  it('uploads a group avatar using form data', () => {
    const file = new File(['data'], 'avatar.png', { type: 'image/png' });

    service.uploadGroupAvatar('g1', file).subscribe(response => {
      expect(response.success).toBeTrue();
    });

    const req = httpMock.expectOne('http://localhost:3000/api/groups/g1/avatar');
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBeTrue();
    req.flush({ success: true });
  });
});
