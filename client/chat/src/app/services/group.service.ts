import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Group } from '../models/group.model';

@Injectable({
    providedIn: 'root'
})
export class GroupService {
    private apiUrl = 'http://localhost:3000/api/groups';

    constructor(private http: HttpClient) {}

    // Retrieves all groups visible to the caller (scope enforced server-side).
    getGroups(): Observable<Group[]> {
        return this.http.get<Group[]>(this.apiUrl);
    }

    // Lists groups associated with a specific user id.
    getUserGroups(userId: string): Observable<Group[]> {
        return this.http.get<Group[]>(`${this.apiUrl}/user/${userId}`);
    }

    // Creates a group with the provided name.
    createGroup(name: string, createdBy: string): Observable<Group> {
        return this.http.post<Group>(this.apiUrl, { name, createdBy });
    }

    // Adds a member to the given group.
    addUserToGroup(groupId: string, userId: string): Observable<Group> {
        return this.http.post<Group>(`${this.apiUrl}/${groupId}/members`, { userId });
    }

    // Removes a member from the given group.
    removeUserFromGroup(groupId: string, userId: string): Observable<Group> {
        return this.http.delete<Group>(`${this.apiUrl}/${groupId}/members/${userId}`);
    }

    // Deletes a group and all related data.
    deleteGroup(id: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`);
    }

    // Uploads and processes a new avatar for the specified group.
    uploadGroupAvatar(groupId: string, file: File): Observable<{ success?: boolean; group?: Group }> {
        const formData = new FormData();
        formData.append('avatar', file);
        return this.http.post<{ success?: boolean; group?: Group }>(`${this.apiUrl}/${groupId}/avatar`, formData);
    }
}
