import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../models/user.model';

@Injectable({
    providedIn: 'root'
})
export class UserService {
    private apiUrl = 'http://localhost:3000/api/users';

    constructor(private http: HttpClient) {}

    // Retrieves all users for administrative views.
    getUsers(): Observable<User[]> {
        return this.http.get<User[]>(this.apiUrl);
    }

    // Creates a new user account via the admin API.
    createUser(payload: { username: string; email: string; password: string; roles?: string[]; groups?: string[] }): Observable<{ success: boolean; user: User }> {
        return this.http.post<{ success: boolean; user: User }>(this.apiUrl, payload);
    }

    // Fetches a single user by identifier.
    getUser(id: string): Observable<User> {
        return this.http.get<User>(`${this.apiUrl}/${id}`);
    }

    // Applies updates to a user profile.
    updateUser(id: string, updates: Partial<User>): Observable<User> {
        return this.http.put<User>(`${this.apiUrl}/${id}`, updates);
    }

    // Removes a user completely.
    deleteUser(id: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`);
    }

    // Grants group-admin privileges to the target user.
    promoteToGroupAdmin(id: string): Observable<User> {
        return this.http.post<User>(`${this.apiUrl}/${id}/promote`, {});
    }
}
