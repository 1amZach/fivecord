// Times are unix seconds throughout.

export interface PlayerRecord {
    license: string;
    name: string;
    discord?: string;
    identifiers: string[];
    tokens: string[];
    firstSeen: number;
    lastSeen: number;
    playtime: number;
}

export interface Ban {
    id: number;
    license: string;
    name: string;
    identifiers: string[];
    tokens: string[];
    reason: string;
    staff: string;
    created: number;
    expires: number | null;
    revokedBy: string | null;
    revokedAt: number | null;
}

export interface Entry {
    id: number;
    license: string;
    text: string;
    staff: string;
    created: number;
}

export type Seen = Pick<PlayerRecord, 'license' | 'name' | 'discord' | 'identifiers' | 'tokens'>;

export interface Store {
    readonly kind: 'mysql' | 'file';
    init(): Promise<void>;

    seen(player: Seen, now: number): Promise<void>;
    addPlaytime(license: string, seconds: number): Promise<void>;
    player(license: string): Promise<PlayerRecord | undefined>;
    byDiscord(id: string): Promise<PlayerRecord | undefined>;
    search(query: string, limit: number): Promise<PlayerRecord[]>;
    top(limit: number): Promise<PlayerRecord[]>;

    bans(): Promise<Ban[]>;
    addBan(ban: Omit<Ban, 'id'>): Promise<number>;
    revokeBan(id: number, by: string, at: number): Promise<void>;

    entries(kind: 'warning' | 'note', license: string): Promise<Entry[]>;
    addEntry(kind: 'warning' | 'note', entry: Omit<Entry, 'id'>): Promise<number>;
    removeEntry(kind: 'warning' | 'note', id: number): Promise<Entry | undefined>;
}
