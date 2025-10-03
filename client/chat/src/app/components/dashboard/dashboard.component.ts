import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GroupService } from '../../services/group.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { Channel } from '../../models/channel.model';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../services/confirm.service';
import { NotifyService } from '../../services/notify.service';
import { firstValueFrom } from 'rxjs';


@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
    currentUser: User | null = null;
    groups: Group[] = [];
    channels: { [groupId: string]: Channel[] } = {};
    selectedGroup: Group | null = null;
    avatarUploading = false;
    profileSaving = false;
    profileMenuOpen = false;
    readonly mediaBaseUrl = 'http://localhost:3000';

    @ViewChild('avatarPicker') avatarPicker?: ElementRef<HTMLInputElement>;

    editableUser = {
        username: '',
        email: ''
    };

    constructor(
        private authService: AuthService,
        private groupService: GroupService,
        private router: Router,
        private http: HttpClient,
        private confirm: ConfirmService,
        private notify: NotifyService
    ) {}

    // Loads initial user context when the dashboard mounts.
    ngOnInit(): void {
        this.currentUser = this.authService.currentUserValue;
        if (this.currentUser) {
            this.loadUserGroups();
        }
    }

    // Normalises media URLs for display, accounting for relative paths.
    mediaUrl(url?: string | null): string | null {
        if (!url) return null;
        if (/^https?:\/\//i.test(url)) {
            return url;
        }
        if (url.startsWith('//')) {
            return `${typeof window !== 'undefined' ? window.location.protocol : 'http:'}${url}`;
        }
        if (url.startsWith('/')) {
            return `${this.mediaBaseUrl}${url}`;
        }
        return `${this.mediaBaseUrl}/${url}`;
    }

    // Toggles the profile dropdown and seeds editable fields when opened.
    toggleProfileMenu(event?: Event): void {
        event?.stopPropagation();
        if (!this.currentUser) {
            return;
        }
        this.profileMenuOpen = !this.profileMenuOpen;
        if (this.profileMenuOpen) {
            this.editableUser = {
                username: this.currentUser.username,
                email: this.currentUser.email
            };
        }
    }

    // Opens the hidden avatar file input.
    openAvatarPicker(event?: Event): void {
        event?.stopPropagation();
        this.avatarPicker?.nativeElement?.click();
    }

    // Derives the initial letter for the current user's avatar fallback.
    get currentUserInitial(): string {
        const username = this.currentUser?.username;
        return username ? username.charAt(0).toUpperCase() : '';
    }

    // Returns the initial character for a group's placeholder avatar.
    groupInitial(group: Group | null): string {
        const name = group?.name;
        return name ? name.charAt(0).toUpperCase() : '#';
    }

    // Uploads a new profile avatar and refreshes the cached user profile.
    async handleAvatarSelected(event: Event): Promise<void> {
        if (!this.currentUser) {
            return;
        }
        event.stopPropagation();
        const input = event.target as HTMLInputElement;
        const file = input?.files && input.files.length ? input.files[0] : null;
        if (!file) {
            return;
        }
        if (!file.type.startsWith('image/')) {
            this.notify.error('Only image files are allowed');
            if (input) input.value = '';
            return;
        }

        const formData = new FormData();
        formData.append('avatar', file);
        this.avatarUploading = true;

        try {
            const response = await firstValueFrom(
                this.http.post<{ success?: boolean; user?: User }>(
                    `http://localhost:3000/api/users/${this.currentUser.id}/avatar`,
                    formData
                )
            );
            if (!response || response.success === false || !response.user) {
                const errorMessage = (response as any)?.message || 'Failed to upload profile image';
                throw new Error(errorMessage);
            }
            this.currentUser = response.user;
            this.authService.setCurrentUser(response.user);
            this.notify.success('Profile image updated.');
            if (this.profileMenuOpen) {
                this.editableUser.username = response.user.username;
                this.editableUser.email = response.user.email;
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to upload profile image';
            this.notify.error(message);
        } finally {
            this.avatarUploading = false;
            if (input) {
                input.value = '';
            }
        }
    }

    // Persists edits to the user's profile details.
    async saveProfileChanges(): Promise<void> {
        if (!this.currentUser) {
            return;
        }

        const username = this.editableUser.username.trim();
        const email = this.editableUser.email.trim();
        if (!username || !email) {
            this.notify.error('Username and email are required.');
            return;
        }

        this.profileSaving = true;
        try {
            const updated = await firstValueFrom(
                this.http.put<User>(`http://localhost:3000/api/users/${this.currentUser.id}`, {
                    username,
                    email
                })
            );
            this.currentUser = updated;
            this.authService.setCurrentUser(updated);
            this.notify.success('Profile updated.');
            this.profileMenuOpen = false;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update profile';
            this.notify.error(message);
        } finally {
            this.profileSaving = false;
        }
    }

    // Closes the profile editor without saving.
    cancelProfileChanges(event?: Event): void {
        event?.stopPropagation();
        this.profileMenuOpen = false;
    }

    // Fetches the groups the user belongs to and hydrates channel lists.
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

    // Fetches channels for the specified group and caches them locally.
    loadChannels(groupId: string): void {
        this.http.get<Channel[]>(`http://localhost:3000/api/channels/group/${groupId}`)
            .subscribe({
                next: (channels) => {
                    this.channels[groupId] = channels;
                }
            });
    }

    // Marks a group as selected in the UI.
    selectGroup(group: Group): void {
        this.selectedGroup = group;
    }

    // Navigates into the chat view for the selected channel.
    enterChannel(groupId: string, channelId: string): void {
        this.router.navigate(['/chat', groupId, channelId]);
    }

    // Opens the super-admin panel when authorised.
    goToAdmin(): void {
        if (this.authService.isSuperAdmin()) {
            this.router.navigate(['/admin']);
        }
    }

    // Opens the group-admin workspace when authorised.
    goToGroupAdmin(): void {
        if (this.authService.isGroupAdmin()) {
            this.router.navigate(['/group-admin']);
        }
    }

    // Confirms and performs a logout, then redirects to the login screen.
    async logout(): Promise<void> {
        const ok = await this.confirm.ask('Are you sure you want to logout?', 'Confirm Logout');
        if (!ok) return;
        this.authService.logout();
        this.notify.info('Logged out');
        this.router.navigate(['/login']);
    }

    // Indicates if the current user holds the super-admin role.
    get isSuperAdmin(): boolean {
        return this.authService.isSuperAdmin();
    }

    // Indicates if the current user holds a group-admin or super-admin role.
    get isGroupAdmin(): boolean {
        return this.authService.isGroupAdmin();
    }

    // Total group count for dashboard metrics.
    get totalGroups(): number {
        return this.groups.length;
    }

    // Total channel count across all groups.
    get totalChannels(): number {
        return Object.values(this.channels).reduce((count, list) => {
            return count + (Array.isArray(list) ? list.length : 0);
        }, 0);
    }

    // Distinct member count computed from all groups.
    get totalMembers(): number {
        const memberIds = new Set<string>();
        this.groups.forEach(group => {
            if (group.createdBy) {
                memberIds.add(group.createdBy);
            }
            (group.admins || []).forEach(id => memberIds.add(id));
            (group.members || []).forEach(id => memberIds.add(id));
        });
        return memberIds.size;
    }

    // Returns the channel count for the provided group helper.
    channelCountFor(group: Group): number {
        if (!group) {
            return 0;
        }
        const list = this.channels[group.id];
        return Array.isArray(list) ? list.length : 0;
    }

    // Nicely formats role identifiers for display.
    formatRole(role: string): string {
        return role
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }
}
