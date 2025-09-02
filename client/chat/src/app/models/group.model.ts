export interface Group {
    id: string;
    name: string;
    createdBy: string;
    admins: string[];
    members: string[];
    createdAt: Date;
}