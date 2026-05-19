export interface ChatSession {
    id: string;
    title: string;
    updatedAt: number;
    memory: any[];
}
export declare class SessionManager {
    private filePath;
    constructor(filePath?: string);
    getAllSessions(): Promise<ChatSession[]>;
    saveSession(session: ChatSession): Promise<void>;
}
