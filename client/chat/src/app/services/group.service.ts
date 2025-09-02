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

    getGroups(): Observable<Group[]> {
        return this.http.get<Group[]>(this.apiUrl);
    }

    getUserGroups(userId: string): Observable<Group[]> {
        return this.http.get<Group[]>(`${this.apiUrl}/user/${userId}`);
    }

    createGroup(name: string, createdBy: string): Observable<Group> {
        return this.http.post<Group>(this.apiUrl, { name, createdBy });
    }

    addUserToGroup(groupId: string, userId: string): Observable<Group> {
        return this.http.post<Group>(`${this.apiUrl}/${groupId}/members`, { userId });
    }

    removeUserFromGroup(groupId: string, userId: string): Observable<Group> {
        return this.http.delete<Group>(`${this.apiUrl}/${groupId}/members/${userId}`);
    }

    deleteGroup(id: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`);
    }
}