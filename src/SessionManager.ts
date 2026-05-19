import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface ChatSession {
    id: string;
    title: string;
    updatedAt: number;
    memory: any[];
}

export class SessionManager {
    private filePath: string;

    constructor(filePath: string = './sessions.json') {
        this.filePath = filePath;
    }

    public async getAllSessions(): Promise<ChatSession[]> {
        if (!existsSync(this.filePath)) {
            return [];
        }
        try {
            const data = await readFile(this.filePath, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            return [];
        }
    }

    public async saveSession(session: ChatSession): Promise<void> {
        let sessions = await this.getAllSessions();
        const index = sessions.findIndex(s => s.id === session.id);
        
        session.updatedAt = Date.now();
        
        if (index > -1) {
            sessions[index] = session;
        } else {
            sessions.push(session);
        }

        // Sort by most recently updated
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        await writeFile(this.filePath, JSON.stringify(sessions, null, 4), 'utf-8');
    }
}
