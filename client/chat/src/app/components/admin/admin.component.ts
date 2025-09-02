import { Component, OnInit } from '@angular/core';
import { UserService } from '../../services/user.service';
import { GroupService } from '../../services/group.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';

@Component({
    selector: 'app-admin',
    templateUrl: './admin.component.html',
    styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit {
    users: User[] = [];
    groups: Group[] = [];
    selectedUser: User | null = null;
    selectedGroup: Group | null = null;

    constructor(
        private userService: UserService,
        private groupService: GroupService
    ) {}

    ngOnInit(): void {
        this.loadUsers();
        this.loadGroups();
    }

    loadUsers(): void {
        this.userService.getUsers().subscribe({
            next: (users) => {
                this.users = users;
            }
        });
    }

    loadGroups(): void {
        this.groupService.getGroups().subscribe({
            next: (groups) => {
                this.groups = groups;
            }
        });
    }

    selectUser(user: User): void {
        this.selectedUser = user;
    }

    selectGroup(group: Group): void {
        this.selectedGroup = group;
    }

    promoteToGroupAdmin(userId: string): void {
        this.userService.promoteToGroupAdmin(userId).subscribe({
            next: () => {
                this.loadUsers();
                alert('User promoted to Group Admin successfully');
            }
        });
    }

    promoteToSuperAdmin(userId: string): void {
        const user = this.users.find(u => u.id === userId);
        if (user && !user.roles.includes('super-admin')) {
            user.roles.push('super-admin');
            this.userService.updateUser(userId, { roles: user.roles }).subscribe({
                next: () => {
                    this.loadUsers();
                    alert('User promoted to Super Admin successfully');
                }
            });
        }
    }

    deleteUser(userId: string): void {
        if (confirm('Are you sure you want to delete this user?')) {
            this.userService.deleteUser(userId).subscribe({
                next: () => {
                    this.loadUsers();
                    this.selectedUser = null;
                    alert('User deleted successfully');
                }
            });
        }
    }

    deleteGroup(groupId: string): void {
        if (confirm('Are you sure you want to delete this group?')) {
            this.groupService.deleteGroup(groupId).subscribe({
                next: () => {
                    this.loadGroups();
                    this.selectedGroup = null;
                    alert('Group deleted successfully');
                }
            });
        }
    }

    addUserToGroup(userId: string, groupId: string): void {
        this.groupService.addUserToGroup(groupId, userId).subscribe({
            next: () => {
                this.loadGroups();
                this.loadUsers();
                alert('User added to group successfully');
            }
        });
    }

    removeUserFromGroup(userId: string, groupId: string): void {
        this.groupService.removeUserFromGroup(groupId, userId).subscribe({
            next: () => {
                this.loadGroups();
                this.loadUsers();
                alert('User removed from group successfully');
            }
        });
    }
}