"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileManager = void 0;
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
class ProfileManager {
    filePath;
    constructor(filePath = './models.json') {
        this.filePath = filePath;
    }
    async saveProfile(profile) {
        let profiles = [];
        if ((0, node_fs_1.existsSync)(this.filePath)) {
            const data = await (0, promises_1.readFile)(this.filePath, 'utf-8');
            try {
                profiles = JSON.parse(data);
            }
            catch (e) { }
        }
        const index = profiles.findIndex(p => p.name === profile.name);
        if (index > -1) {
            profiles[index] = profile;
        }
        else {
            profiles.push(profile);
        }
        await (0, promises_1.writeFile)(this.filePath, JSON.stringify(profiles, null, 4), 'utf-8');
    }
    async loadProfile(name) {
        const profiles = await this.getAllProfiles();
        const profile = profiles.find(p => p.name === name);
        if (!profile) {
            throw new Error(`Model profile '${name}' not found in JSON.`);
        }
        return profile;
    }
    async getAllProfiles() {
        if (!(0, node_fs_1.existsSync)(this.filePath)) {
            return [];
        }
        const data = await (0, promises_1.readFile)(this.filePath, 'utf-8');
        try {
            return JSON.parse(data);
        }
        catch (e) {
            return [];
        }
    }
}
exports.ProfileManager = ProfileManager;
