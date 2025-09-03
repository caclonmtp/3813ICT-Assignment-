import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { GroupService } from '../../services/group.service';
import { UserService } from '../../services/user.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { Channel } from '../../models/channel.model';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NotifyService } from '../../services/notify.service';
import { ConfirmService } from '../../services/confirm.service';


@Component({
    selector: 'app-group-admin',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule],
    templateUrl: './group-admin.component.html',
    styleUrls: ['./group-admin.component.css']
})
export class GroupAdminComponent implements OnInit {
    currentUser: User | null = null;
    myGroups: Group[] = [];
    allUsers: User[] = [];
    selectedGroup: Group | null = null;
    groupChannels: Channel[] = [];
    groupMembers: User[] = [];
    availableUsers: User[] = [];
    
    newGroupName: string = '';
    newChannelName: string = '';
    showCreateGroup: boolean = false;
    showCreateChannel: boolean = false;
    showAddMember: boolean = false;

    constructor(
        private authService: AuthService,
        private groupService: GroupService,
        private userService: UserService,
        private http: HttpClient,
        private notify: NotifyService,
        private confirm: ConfirmService
    ) {}

    ngOnInit(): void {
        this.currentUser = this.authService.currentUserValue;
        this.loadMyGroups();
        this.loadAllUsers();
    }

    loadMyGroups(): void {
        if (!this.currentUser) return;

        this.groupService.getGroups().subscribe({
            next: (groups) => {
                this.myGroups = groups.filter(g => 
                    g.createdBy === this.currentUser!.id ||
                    g.admins.includes(this.currentUser!.id) ||
                    this.authService.isSuperAdmin()
                );
                
                if (this.selectedGroup) {
                    this.selectedGroup = this.myGroups.find(g => g.id === this.selectedGroup!.id) || null;
                    if (this.selectedGroup) {
                        this.loadGroupDetails(this.selectedGroup);
                    }
                }
            }
        });
    }

    loadAllUsers(): void {
        this.userService.getUsers().subscribe({
            next: (users) => {
                this.allUsers = users;
                this.updateAvailableUsers();
            }
        });
    }

    selectGroup(group: Group): void {
        this.selectedGroup = group;
        this.loadGroupDetails(group);
    }

    loadGroupDetails(group: Group): void {
        this.http.get<Channel[]>(`http://localhost:3000/api/channels/group/${group.id}`)
            .subscribe({
                next: (channels) => {
                    this.groupChannels = channels;
                }
            });

        this.groupMembers = this.allUsers.filter(u => group.members.includes(u.id));
        this.updateAvailableUsers();
    }

    updateAvailableUsers(): void {
        if (this.selectedGroup) {
            this.availableUsers = this.allUsers.filter(u => 
                !this.selectedGroup!.members.includes(u.id)
            );
        }
    }

    async createGroup(): Promise<void> {
        if (!this.newGroupName.trim() || !this.currentUser) return;
        const ok = await this.confirm.ask(`Create group "${this.newGroupName.trim()}"?`, 'Confirm Create');
        if (!ok) return;
        this.groupService.createGroup(this.newGroupName, this.currentUser.id)
            .subscribe({
                next: () => {
                    this.newGroupName = '';
                    this.showCreateGroup = false;
                    this.loadMyGroups();
                    this.notify.success('Group created successfully');
                },
                error: () => this.notify.error('Failed to create group')
            });
    }

    async createChannel(): Promise<void> {
        if (!this.newChannelName.trim() || !this.selectedGroup || !this.currentUser) return;
        const ok = await this.confirm.ask(`Create channel "${this.newChannelName.trim()}" in ${this.selectedGroup.name}?`, 'Confirm Create');
        if (!ok) return;
        this.http.post('http://localhost:3000/api/channels', {
            name: this.newChannelName,
            groupId: this.selectedGroup.id,
            createdBy: this.currentUser.id
        }).subscribe({
            next: () => {
                this.newChannelName = '';
                this.showCreateChannel = false;
                this.loadGroupDetails(this.selectedGroup!);
                this.notify.success('Channel created successfully');
            },
            error: () => this.notify.error('Failed to create channel')
        });
    }

    async addMemberToGroup(userId: string): Promise<void> {
        if (!this.selectedGroup) return;
        const user = this.allUsers.find(u => u.id === userId);
        const ok = await this.confirm.ask(`Add ${user?.username} to ${this.selectedGroup.name}?`, 'Confirm Add');
        if (!ok) return;
        this.groupService.addUserToGroup(this.selectedGroup.id, userId)
            .subscribe({
                next: () => {
                    this.loadMyGroups();
                    this.showAddMember = false;
                    this.notify.success('Member added successfully');
                },
                error: () => this.notify.error('Failed to add member')
            });
    }

    async removeMemberFromGroup(userId: string): Promise<void> {
        if (!this.selectedGroup) return;
        const user = this.allUsers.find(u => u.id === userId);
        const ok = await this.confirm.ask(`Remove ${user?.username} from ${this.selectedGroup.name}?`, 'Confirm Remove');
        if (!ok) return;
        this.groupService.removeUserFromGroup(this.selectedGroup.id, userId)
            .subscribe({
                next: () => {
                    this.loadMyGroups();
                    this.notify.success('Member removed successfully');
                },
                error: () => this.notify.error('Failed to remove member')
            });
    }

    async deleteChannel(channelId: string): Promise<void> {
        const ch = this.groupChannels.find(c => c.id === channelId);
        const ok = await this.confirm.ask(`Delete channel "${ch?.name}"? This cannot be undone.`, 'Confirm Delete');
        if (!ok) return;
        this.http.delete(`http://localhost:3000/api/channels/${channelId}`)
            .subscribe({
                next: () => {
                    this.loadGroupDetails(this.selectedGroup!);
                    this.notify.success('Channel deleted successfully');
                },
                error: () => this.notify.error('Failed to delete channel')
            });
    }

    async deleteGroup(groupId: string): Promise<void> {
        const g = this.myGroups.find(x => x.id === groupId);
        const ok = await this.confirm.ask(`Delete group "${g?.name}" and all its channels?`, 'Confirm Delete');
        if (!ok) return;
        this.groupService.deleteGroup(groupId)
            .subscribe({
                next: () => {
                    this.selectedGroup = null;
                    this.loadMyGroups();
                    this.notify.success('Group deleted successfully');
                },
                error: () => this.notify.error('Failed to delete group')
            });
    }

    canDeleteGroup(group: Group): boolean {
        return group.createdBy === this.currentUser?.id || this.authService.isSuperAdmin();
    }
}
