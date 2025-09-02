import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GroupService } from '../../services/group.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { Channel } from '../../models/channel.model';
import { HttpClient } from '@angular/common/http';

@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
    currentUser: User | null = null;
    groups: Group[] = [];
    channels: { [groupId: string]: Channel[] } = {};
    selectedGroup: Group | null = null;

    constructor(
        private authService: AuthService,
        private groupService: GroupService,
        private router: Router,
        private http: HttpClient
    ) {}

    ngOnInit(): void {
        this.currentUser = this.authService.currentUserValue;
        if (this.currentUser) {
            this.loadUserGroups();
        }
    }

    loadUserGroups(): void {
        if (!this.currentUser) return;
        
        this.groupService.getUserGroups(this.currentUser.id).subscribe({
            next: (groups) => {
                this.groups = groups;
                groups.forEach(group => {
                    this.loadChannels(group.id);
                });
            }
        });
    }

    loadChannels(groupId: string): void {
        this.http.get<Channel[]>(`http://localhost:3000/api/channels/group/${groupId}`)
            .subscribe({
                next: (channels) => {
                    this.channels[groupId] = channels;
                }
            });
    }

    selectGroup(group: Group): void {
        this.selectedGroup = group;
    }

    enterChannel(groupId: string, channelId: string): void {
        this.router.navigate(['/chat', groupId, channelId]);
    }

    goToAdmin(): void {
        if (this.authService.isSuperAdmin()) {
            this.router.navigate(['/admin']);
        }
    }

    goToGroupAdmin(): void {
        if (this.authService.isGroupAdmin()) {
            this.router.navigate(['/group-admin']);
        }
    }

    logout(): void {
        this.authService.logout();
        this.router.navigate(['/login']);
    }

    get isSuperAdmin(): boolean {
        return this.authService.isSuperAdmin();
    }

    get isGroupAdmin(): boolean {
        return this.authService.isGroupAdmin();
    }
}