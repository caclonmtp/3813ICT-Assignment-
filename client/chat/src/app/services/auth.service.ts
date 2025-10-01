import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { User } from '../models/user.model';
import { StorageService } from './storage.service';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private apiUrl = 'http://localhost:3000/api';
    private currentUserSubject: BehaviorSubject<User | null>;
    public currentUser: Observable<User | null>;

    constructor(
        private http: HttpClient,
        private storageService: StorageService
    ) {
        const storedUser = this.storageService.getItem('currentUser');
        this.currentUserSubject = new BehaviorSubject<User | null>(
            storedUser ? JSON.parse(storedUser) : null
        );
        this.currentUser = this.currentUserSubject.asObservable();
    }

    public get currentUserValue(): User | null {
        return this.currentUserSubject.value;
    }

    login(username: string, password: string): Observable<any> {
        return this.http.post<any>(`${this.apiUrl}/auth/login`, { username, password })
            .pipe(tap(response => {
                if (response.success) {
                    this.storageService.setItem('currentUser', JSON.stringify(response.user));
                    this.currentUserSubject.next(response.user);
                }
            }));
    }

    register(username: string, email: string, password: string): Observable<any> {
        // Do not auto-login after register; let user return to login screen
        return this.http.post<any>(`${this.apiUrl}/auth/register`, { username, email, password });
    }

    logout(): void {
        this.storageService.removeItem('currentUser');
        this.currentUserSubject.next(null);
    }

    setCurrentUser(user: User): void {
        if (!user) {
            return;
        }
        this.storageService.setItem('currentUser', JSON.stringify(user));
        this.currentUserSubject.next(user);
    }

    mergeCurrentUser(partial: Partial<User>): User | null {
        const current = this.currentUserSubject.value;
        if (!current) {
            return null;
        }
        const updated = { ...current, ...partial } as User;
        this.storageService.setItem('currentUser', JSON.stringify(updated));
        this.currentUserSubject.next(updated);
        return updated;
    }

    isSuperAdmin(): boolean {
        return this.currentUserValue?.roles.includes('super-admin') || false;
    }

    isGroupAdmin(): boolean {
        return this.currentUserValue?.roles.includes('group-admin') || 
               this.currentUserValue?.roles.includes('super-admin') || false;
    }
}
