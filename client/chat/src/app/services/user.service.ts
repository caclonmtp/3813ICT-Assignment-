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

    getUsers(): Observable<User[]> {
        return this.http.get<User[]>(this.apiUrl);
    }

    getUser(id: string): Observable<User> {
        return this.http.get<User>(`${this.apiUrl}/${id}`);
    }

    updateUser(id: string, updates: Partial<User>): Observable<User> {
        return this.http.put<User>(`${this.apiUrl}/${id}`, updates);
    }

    deleteUser(id: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`);
    }

    promoteToGroupAdmin(id: string): Observable<User> {
        return this.http.post<User>(`${this.apiUrl}/${id}/promote`, {});
    }
}