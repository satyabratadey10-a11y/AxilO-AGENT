import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface ModelProfile {
    name: string;
    api: string;
    apiKey?: string;
    modelId?: string;
    extraParams?: any;
}

export class ProfileManager {
    private filePath: string;

    constructor(filePath: string = './models.json') {
        this.filePath = filePath;
    }

    public async saveProfile(profile: ModelProfile): Promise<void> {
        let profiles: ModelProfile[] = [];
        
        if (existsSync(this.filePath)) {
            const data = await readFile(this.filePath, 'utf-8');
            try { profiles = JSON.parse(data); } catch (e) {}
        }
        
        const index = profiles.findIndex(p => p.name === profile.name);
        if (index > -1) {
            profiles[index] = profile;
        } else {
            profiles.push(profile);
        }

        await writeFile(this.filePath, JSON.stringify(profiles, null, 4), 'utf-8');
    }

    public async loadProfile(name: string): Promise<ModelProfile> {
        const profiles = await this.getAllProfiles();
        const profile = profiles.find(p => p.name === name);
        if (!profile) {
            throw new Error(`Model profile '${name}' not found in JSON.`);
        }
        return profile;
    }

    public async getAllProfiles(): Promise<ModelProfile[]> {
        if (!existsSync(this.filePath)) {
            return [];
        }
        const data = await readFile(this.filePath, 'utf-8');
        try {
            return JSON.parse(data);
        } catch (e) {
            return [];
        }
    }
}
