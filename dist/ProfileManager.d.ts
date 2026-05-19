export interface ModelProfile {
    name: string;
    api: string;
    apiKey?: string;
    modelId?: string;
    extraParams?: any;
}
export declare class ProfileManager {
    private filePath;
    constructor(filePath?: string);
    saveProfile(profile: ModelProfile): Promise<void>;
    loadProfile(name: string): Promise<ModelProfile>;
    getAllProfiles(): Promise<ModelProfile[]>;
}
