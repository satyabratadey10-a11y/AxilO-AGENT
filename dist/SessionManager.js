"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
class SessionManager {
    filePath;
    constructor(filePath = './sessions.json') {
        this.filePath = filePath;
    }
    async getAllSessions() {
        if (!(0, node_fs_1.existsSync)(this.filePath)) {
            return [];
        }
        try {
            const data = await (0, promises_1.readFile)(this.filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch (e) {
            return [];
        }
    }
    async saveSession(session) {
        let sessions = await this.getAllSessions();
        const index = sessions.findIndex(s => s.id === session.id);
        session.updatedAt = Date.now();
        if (index > -1) {
            sessions[index] = session;
        }
        else {
            sessions.push(session);
        }
        // Sort by most recently updated
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        await (0, promises_1.writeFile)(this.filePath, JSON.stringify(sessions, null, 4), 'utf-8');
    }
}
exports.SessionManager = SessionManager;
