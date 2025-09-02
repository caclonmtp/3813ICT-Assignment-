// src/app/channels/channel-view.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router'; 
import { StoreService } from '../services/store.service';
import { SessionService } from '../services/session.service';
import { RbacService } from '../services/rbac.service';
import { Group, Channel, Message, User } from '../models';

@Component({
  selector: 'app-channel-view',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './channel-view.component.html', 
})

export class ChannelViewComponent implements OnInit {
  group: Group | undefined;
  channel: Channel | undefined;
  history: Message[] = [];
  newMessage = '';

  private gid: string | null = null;
  private cid: string | null = null;

  constructor(
    private route: ActivatedRoute, 
    public store: StoreService,
    public session: SessionService,
    public rbac: RbacService
  ) {}

  ngOnInit(): void {
    this.gid = this.route.snapshot.paramMap.get('gid');
    this.cid = this.route.snapshot.paramMap.get('cid');
    this.refresh();
  }

  refresh(): void {
    if (!this.gid || !this.cid) return;

    this.group = this.store.groups().find((g: Group) => g.id === this.gid);
    this.channel = this.store.channels().find((c: Channel) => c.id === this.cid && c.groupId === this.gid);

    this.history = this.store.messages()
      .filter((m: Message) => m.channelId === this.cid)
      .sort((a: Message, b: Message) => a.createdAt - b.createdAt);
  }

  post(): void {
    const user = this.session.currentUser();
    if (!user || !this.channel || !this.newMessage.trim()) return;

    const msg: Message = {
      id: crypto.randomUUID(),
      channelId: this.channel.id,
      authorId: user.id,
      text: this.newMessage.trim(),
      createdAt: Date.now(),
    };

    const messages = this.store.messages();
    messages.push(msg);
    this.store.saveMessages(messages);

    this.newMessage = '';
    this.refresh();
  }

  
  authorName(uid: string): string {
    return this.store.users().find((u: User) => u.id === uid)?.username || 'Unknown';
  }

  ban(authorId: string): void {
    if (!this.group || !this.rbac.isGroupOwner(this.group)) return;
    alert(`Banning user ${this.authorName(authorId)} from channel ${this.channel?.name}.`);
  }
}