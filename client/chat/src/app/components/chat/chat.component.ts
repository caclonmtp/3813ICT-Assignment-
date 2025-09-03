import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models/user.model';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Message {
    id: string;
    userId: string;
    username: string;
    content: string;
    timestamp: Date;
    channelId: string;
}

@Component({
    selector: 'app-chat',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './chat.component.html',
    styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
    currentUser: User | null = null;
    groupId: string = '';
    channelId: string = '';
    channelName: string = '';
    groupName: string = '';
    messages: Message[] = [];
    newMessage: string = '';
    groupMembers: User[] = [];
    private messageInterval: any;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private authService: AuthService,
        private http: HttpClient
    ) {}

    ngOnInit(): void {
        this.currentUser = this.authService.currentUserValue;
        
        this.route.params.subscribe(params => {
            this.groupId = params['groupId'];
            this.channelId = params['channelId'];
            this.loadChannelInfo();
            this.loadMessages();
            this.loadGroupMembers();
        });

        this.messageInterval = setInterval(() => {
            this.loadMessages();
        }, 3000);
    }

    ngOnDestroy(): void {
        if (this.messageInterval) {
            clearInterval(this.messageInterval);
        }
    }

    loadChannelInfo(): void {
        this.http.get<any>(`http://localhost:3000/api/channels/group/${this.groupId}`)
            .subscribe(channels => {
                const channel = channels.find((c: any) => c.id === this.channelId);
                if (channel) {
                    this.channelName = channel.name;
                }
            });

        this.http.get<any>(`http://localhost:3000/api/groups`)
            .subscribe(groups => {
                const group = groups.find((g: any) => g.id === this.groupId);
                if (group) {
                    this.groupName = group.name;
                }
            });
    }

    loadMessages(): void {
        const storedMessages = localStorage.getItem(`messages_${this.channelId}`);
        if (storedMessages) {
            this.messages = JSON.parse(storedMessages);
        }
    }

    loadGroupMembers(): void {
        this.http.get<any>(`http://localhost:3000/api/groups`)
            .subscribe(groups => {
                const group = groups.find((g: any) => g.id === this.groupId);
                if (group) {
                    this.http.get<User[]>('http://localhost:3000/api/users')
                        .subscribe(users => {
                            this.groupMembers = users.filter(u => 
                                group.members.includes(u.id)
                            );
                        });
                }
            });
    }

    sendMessage(): void {
        if (!this.newMessage.trim() || !this.currentUser) return;

        const message: Message = {
            id: Date.now().toString(),
            userId: this.currentUser.id,
            username: this.currentUser.username,
            content: this.newMessage,
            timestamp: new Date(),
            channelId: this.channelId
        };

        this.messages.push(message);
        localStorage.setItem(`messages_${this.channelId}`, JSON.stringify(this.messages));
        this.newMessage = '';
        
        setTimeout(() => {
            const messagesContainer = document.querySelector('.messages-container');
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }, 10);
    }

    handleKeyPress(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    }

    backToDashboard(): void {
        this.router.navigate(['/dashboard']);
    }

    formatTime(timestamp: Date): string {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
}