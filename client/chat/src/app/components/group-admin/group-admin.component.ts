import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { GroupService } from '../../services/group.service';
import { UserService } from '../../services/user.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { Channel } from '../../models/channel.model';
import { HttpClient } from '@angular/common/http';

@Component({
    selector: 'app-group-admin',
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
        private http: HttpClient
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
                // Filter groups where current user is admin or created by user
                this.myGroups = groups.filter(g => 
                    g.createdBy === this.currentUser!.id ||
                    g.admins.includes(this.currentUser!.id) ||
                    this.authService.isSuperAdmin()
                );
                
                if (this.selectedGroup) {
                    // Refresh selected group
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
        // Load channels
        this.http.get<Channel[]>(`http://localhost:3000/api/channels/group/${group.id}`)
            .subscribe({
                next: (channels) => {
                    this.groupChannels = channels;
                }
            });

        // Load members
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

    createGroup(): void {
        if (!this.newGroupName.trim() || !this.currentUser) return;

        this.groupService.createGroup(this.newGroupName, this.currentUser.id)
            .subscribe({
                next: () => {
                    this.newGroupName = '';
                    this.showCreateGroup = false;
                    this.loadMyGroups();
                    alert('Group created successfully!');
                }
            });
    }

    createChannel(): void {
        if (!this.newChannelName.trim() || !this.selectedGroup || !this.currentUser) return;

        this.http.post('http://localhost:3000/api/channels', {
            name: this.newChannelName,
            groupId: this.selectedGroup.id,
            createdBy: this.currentUser.id
        }).subscribe({
            next: () => {
                this.newChannelName = '';
                this.showCreateChannel = false;
                this.loadGroupDetails(this.selectedGroup!);
                alert('Channel created successfully!');
            }
        });
    }

    addMemberToGroup(userId: string): void {
        if (!this.selectedGroup) return;

        this.groupService.addUserToGroup(this.selectedGroup.id, userId)
            .subscribe({
                next: () => {
                    this.loadMyGroups();
                    this.showAddMember = false;
                    alert('Member added successfully!');
                }
            });
    }

    removeMemberFromGroup(userId: string): void {
        if (!this.selectedGroup) return;

        if (confirm('Are you sure you want to remove this member?')) {
            this.groupService.removeUserFromGroup(this.selectedGroup.id, userId)
                .subscribe({
                    next: () => {
                        this.loadMyGroups();
                        alert('Member removed successfully!');
                    }
                });
        }
    }

    deleteChannel(channelId: string): void {
        if (confirm('Are you sure you want to delete this channel?')) {
            this.http.delete(`http://localhost:3000/api/channels/${channelId}`)
                .subscribe({
                    next: () => {
                        this.loadGroupDetails(this.selectedGroup!);
                        alert('Channel deleted successfully!');
                    }
                });
        }
    }

    deleteGroup(groupId: string): void {
        if (confirm('Are you sure you want to delete this group? This will also delete all channels.')) {
            this.groupService.deleteGroup(groupId)
                .subscribe({
                    next: () => {
                        this.selectedGroup = null;
                        this.loadMyGroups();
                        alert('Group deleted successfully!');
                    }
                });
        }
    }

    canDeleteGroup(group: Group): boolean {
        return group.createdBy === this.currentUser?.id || this.authService.isSuperAdmin();
    }
}