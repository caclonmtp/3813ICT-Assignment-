import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { StoreService } from '../services/store.service';
import { SessionService } from '../services/session.service';
import { RbacService } from '../services/rbac.service';
import { Group, Channel, User } from '../models';

@Component({
    selector: 'app-group-list',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './group-list.component.html',
})
export class GroupListComponent {
    groups: Group[] = [];
    name = '';
    
    constructor(
      public store: StoreService,
      private session: SessionService,
      public rbac: RbacService,
      private router: Router
    ) { this.refresh(); }
    
    refresh() { this.groups = this.store.groups(); }

    channelName(cid: string): string {
      const ch = this.store.channels().find((c: Channel) => c.id === cid);
      return ch?.name ?? 'unknown';
    }

    createGroup() {
      if (!this.rbac.canCreateGroup()) return;
      const n = this.name.trim(); if (!n) return;
      const u = this.session.currentUser(); if (!u) { this.router.navigate(['/login']); return; }
      const g: Group = { id: crypto.randomUUID(), name: n, adminIds: [u.id], channelIds: [], creatorId: u.id, memberIds: [u.id] };
      const groups = this.store.groups(); groups.push(g); this.store.saveGroups(groups);
      if (!u.groups.includes(g.id)) {
        const users = this.store.users();
        const me = users.find((x: User) => x.id === u.id)!;
        me.groups.push(g.id);
        this.store.saveUsers(users);
      }
      this.name = ''; this.refresh();
    }
        
    myMember(g: Group) { return !!this.session.currentUser()?.groups.includes(g.id); }
        
    join(g: Group) {
        const u = this.session.currentUser(); if (!u) return;
        if (!u.groups.includes(g.id)) {
            u.groups.push(g.id);
            const users = this.store.users();
            this.store.saveUsers(users);
        }
        if (!g.memberIds.includes(u.id)) {
            g.memberIds.push(u.id);
            const gs = this.store.groups();
            this.store.saveGroups(gs);
        }
        this.refresh();
    }
        
    leave(g: Group) {
        const u = this.session.currentUser(); if (!u) return;
        u.groups = u.groups.filter((id: string) => id !== g.id);
        const users = this.store.users();
        this.store.saveUsers(users);

        g.memberIds = g.memberIds.filter((id: string) => id !== u.id);
        const gs = this.store.groups();
        this.store.saveGroups(gs);
        this.refresh();
    }
        
    createChannel(g: Group) {
        const u = this.session.currentUser(); if (!u) return;
        if (!this.rbac.isGroupOwner(g)) return;
        const name = prompt('Channel name?'); if (!name) return;
        const c: Channel = { id: crypto.randomUUID(), groupId: g.id, name: name.trim(), bannedUserIds: [], messageIds: [] };
        const channels = this.store.channels();
        channels.push(c);
        this.store.saveChannels(channels);
        const gs = this.store.groups();
        const gg = gs.find((x: Group) => x.id === g.id)!;
        gg.channelIds.push(c.id);
        this.store.saveGroups(gs);
        this.refresh();
    }
}