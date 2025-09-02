import { Injectable } from '@angular/core';
import { StoreService } from './store.service'; 
import { User, Role } from '../models';

@Injectable({ providedIn: 'root' })
export class SessionService {
  constructor(private store: StoreService) {
    this.store.seedSuper();
  }

  currentUser(): User | null {
    const sess = this.store.session();
    if (!sess) return null;
    return this.store.users().find((u: User) => u.id === sess.userId) || null;
  }

  login(username: string, password: string): { ok: boolean; error?: string } {
    const users = this.store.users();
    const u = users.find((x: User) => x.username === username);
    if (!u) return { ok: false, error: 'User not found. Register first.' };
    if (u.username === 'super' && password !== '123') return { ok: false, error: 'Invalid password for super' };
    this.store.saveSession({ userId: u.id });
    return { ok: true };
  }

  register(username: string, email = '', roles: Role[] = ['USER']): { ok: boolean; error?: string } {
    const users = this.store.users();
    if (users.some((u: User) => u.username.toLowerCase() === username.toLowerCase())) return { ok: false, error: 'Username exists' };
    users.push({ id: crypto.randomUUID(), username, email, roles, groups: [] });
    this.store.saveUsers(users);
    return { ok: true };
  }

  logout() { this.store.saveSession(null); }
}