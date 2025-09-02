export type Role = 'SUPER' | 'GROUP_ADMIN' | 'USER';

export interface User {
id: string;
username: string;
email: string;
roles: Role[];
groups: string[]; 
}

export interface Group {
id: string;
name: string;
adminIds: string[];
channelIds: string[];
creatorId: string;
memberIds: string[];
}

export interface Channel {
id: string;
groupId: string;
name: string;
bannedUserIds: string[];
messageIds: string[];
}

export interface Message {
id: string;
channelId: string;
authorId: string;
text: string;
createdAt: number;
}