import { Injectable } from '@angular/core';
import { SessionService } from './session.service';
import { Group } from '../models';

@Injectable({ providedIn: 'root' })
export class RbacService {
constructor(private session: SessionService) {}
isSuper() { return !!this.session.currentUser()?.roles.includes('SUPER'); }
isGroupAdmin() { return !!this.session.currentUser()?.roles.includes('GROUP_ADMIN'); }
canCreateGroup() { return this.isSuper() || this.isGroupAdmin(); }
isGroupOwner(g: Group) { return this.isSuper() || this.session.currentUser()?.id === g.creatorId; }
}