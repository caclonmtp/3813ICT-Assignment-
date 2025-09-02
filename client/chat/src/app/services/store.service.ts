import { Injectable } from '@angular/core';
import { User, Group, Channel, Message } from '../models';

@Injectable({ providedIn: 'root' })
export class StoreService {
private get<T>(k: string, d: T): T { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) as T : d; }
private set<T>(k: string, v: T) { localStorage.setItem(k, JSON.stringify(v)); }

users() { return this.get<User[]>('chat.users', []); }
saveUsers(v: User[]) { this.set('chat.users', v); }

groups() { return this.get<Group[]>('chat.groups', []); }
saveGroups(v: Group[]) { this.set('chat.groups', v); }

channels() { return this.get<Channel[]>('chat.channels', []); }
saveChannels(v: Channel[]) { this.set('chat.channels', v); }

messages() { return this.get<Message[]>('chat.messages', []); }
saveMessages(v: Message[]) { this.set('chat.messages', v); }

session() { return this.get<{ userId: string } | null>('chat.session', null); }
saveSession(v: { userId: string } | null) { this.set('chat.session', v); }

seedSuper() {
const users = this.users();
if (!users.find(u => u.username === 'super')) {
users.push({ id: crypto.randomUUID(), username: 'super', email: '', roles: ['SUPER'], groups: [] });
this.saveUsers(users);
}
}
}