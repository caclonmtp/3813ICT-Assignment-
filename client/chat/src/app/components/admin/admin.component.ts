import { Component, OnInit } from '@angular/core';
import { UserService } from '../../services/user.service';
import { GroupService } from '../../services/group.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NotifyService } from '../../services/notify.service';
import { ConfirmService } from '../../services/confirm.service';

@Component({
    selector: 'app-admin',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule],
    templateUrl: './admin.component.html',
    styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit {
    users: User[] = [];
    groups: Group[] = [];
    selectedUser: User | null = null;
    selectedGroup: Group | null = null;
    showCreateUser = false;
    createUserLoading = false;
    createUserError: string | null = null;
    newUserUsername = '';
    newUserEmail = '';
    newUserPassword = '';
    addToSelectedGroup = false;

    constructor(
        private userService: UserService,
        private groupService: GroupService,
        private notify: NotifyService,
        private confirm: ConfirmService
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
        this.addToSelectedGroup = !!this.selectedGroup;
    }

    openCreateUser(): void {
        this.resetCreateUserForm();
        this.showCreateUser = true;
    }

    closeCreateUser(): void {
        if (this.createUserLoading) {
            return;
        }
        this.showCreateUser = false;
        this.resetCreateUserForm();
    }

    createUser(): void {
        if (this.createUserLoading) {
            return;
        }

        const username = this.newUserUsername.trim();
        const email = this.newUserEmail.trim();
        const password = this.newUserPassword.trim();

        if (!username || !email || !password) {
            this.createUserError = 'Username, email, and password are required.';
            return;
        }

        this.createUserLoading = true;
        this.createUserError = null;

        this.userService
            .createUser({ username, email, password })
            .subscribe({
                next: response => {
                    if (!response?.success || !response.user) {
                        this.createUserLoading = false;
                        this.createUserError = 'User created but response was incomplete.';
                        return;
                    }

                    const createdUser = response.user;
                    const shouldAddToGroup = this.addToSelectedGroup && !!this.selectedGroup;

                    if (shouldAddToGroup && this.selectedGroup) {
                        this.groupService
                            .addUserToGroup(this.selectedGroup.id, createdUser.id)
                            .subscribe({
                                next: () => {
                                    this.finishUserCreation(createdUser, true);
                                },
                                error: err => {
                                    this.createUserLoading = false;
                                    this.createUserError = this.extractErrorMessage(
                                        err,
                                        'User created but failed to add to selected group.'
                                    );
                                    this.loadUsers();
                                    this.loadGroups();
                                }
                            });
                    } else {
                        this.finishUserCreation(createdUser, false);
                    }
                },
                error: err => {
                    this.createUserLoading = false;
                    this.createUserError = this.extractErrorMessage(err, 'Failed to create user.');
                }
            });
    }

    private finishUserCreation(user: User, addedToGroup: boolean): void {
        const groupName = this.selectedGroup?.name;
        this.createUserLoading = false;
        this.showCreateUser = false;
        this.resetCreateUserForm();
        this.loadUsers();
        if (addedToGroup && groupName) {
            this.loadGroups();
            this.notify.success(`${user.username} added to ${groupName}`);
        } else {
            this.notify.success(`Created user ${user.username}`);
        }
    }

    private resetCreateUserForm(): void {
        this.newUserUsername = '';
        this.newUserEmail = '';
        this.newUserPassword = '';
        this.createUserError = null;
        this.addToSelectedGroup = !!this.selectedGroup;
    }

    private extractErrorMessage(error: unknown, fallback: string): string {
        if (error && typeof error === 'object') {
            const err = error as any;
            const explicit = err?.error?.message || err?.message;
            if (explicit && typeof explicit === 'string') {
                return explicit;
            }
        }
        return fallback;
    }

    async promoteToGroupAdmin(userId: string): Promise<void> {
        const user = this.users.find(u => u.id === userId);
        const ok = await this.confirm.ask(`Promote ${user?.username} to Group Admin?`, 'Confirm Promotion');
        if (!ok) return;
        this.userService.promoteToGroupAdmin(userId).subscribe({
            next: () => {
                this.loadUsers();
                this.notify.success('User promoted to Group Admin');
            },
            error: () => this.notify.error('Failed to promote user')
        });
    }

    async promoteToSuperAdmin(userId: string): Promise<void> {
        const user = this.users.find(u => u.id === userId);
        const ok = await this.confirm.ask(`Promote ${user?.username} to Super Admin?`, 'Confirm Promotion');
        if (!ok || !user) return;
        if (!user.roles.includes('super-admin')) {
            const roles = [...user.roles, 'super-admin'];
            this.userService.updateUser(userId, { roles }).subscribe({
                next: () => {
                    this.loadUsers();
                    this.notify.success('User promoted to Super Admin');
                },
                error: () => this.notify.error('Failed to promote user')
            });
        }
    }

    async deleteUser(userId: string): Promise<void> {
        const user = this.users.find(u => u.id === userId);
        const ok = await this.confirm.ask(`Delete user ${user?.username}? This cannot be undone.`, 'Confirm Delete');
        if (!ok) return;
        this.userService.deleteUser(userId).subscribe({
            next: () => {
                this.loadUsers();
                this.selectedUser = null;
                this.notify.success('User deleted');
            },
            error: () => this.notify.error('Failed to delete user')
        });
    }

    async deleteGroup(groupId: string): Promise<void> {
        const g = this.groups.find(x => x.id === groupId);
        const ok = await this.confirm.ask(`Delete group "${g?.name}" and all its channels?`, 'Confirm Delete');
        if (!ok) return;
        this.groupService.deleteGroup(groupId).subscribe({
            next: () => {
                this.loadGroups();
                this.selectedGroup = null;
                this.notify.success('Group deleted');
            },
            error: () => this.notify.error('Failed to delete group')
        });
    }

    async addUserToGroup(userId: string, groupId: string): Promise<void> {
        const user = this.users.find(u => u.id === userId);
        const g = this.groups.find(x => x.id === groupId);
        const ok = await this.confirm.ask(`Add ${user?.username} to ${g?.name}?`, 'Confirm Add');
        if (!ok) return;
        this.groupService.addUserToGroup(groupId, userId).subscribe({
            next: () => {
                this.loadGroups();
                this.loadUsers();
                this.notify.success('User added to group');
            },
            error: () => this.notify.error('Failed to add user to group')
        });
    }

    async removeUserFromGroup(userId: string, groupId: string): Promise<void> {
        const user = this.users.find(u => u.id === userId);
        const g = this.groups.find(x => x.id === groupId);
        const ok = await this.confirm.ask(`Remove ${user?.username} from ${g?.name}?`, 'Confirm Remove');
        if (!ok) return;
        this.groupService.removeUserFromGroup(groupId, userId).subscribe({
            next: () => {
                this.loadGroups();
                this.loadUsers();
                this.notify.success('User removed from group');
            },
            error: () => this.notify.error('Failed to remove user from group')
        });
    }
}
