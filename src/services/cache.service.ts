type CacheEntry<T> = {
    value: T;
    expiresAt: number;
};

export class CacheService {
    private store = new Map<string, CacheEntry<unknown>>();

    constructor(private defaultTtlMs = 5 * 60 * 1000) {}

    get<T>(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) {
            return undefined;
        }

        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }

        return entry.value as T;
    }

    set<T>(key: string, value: T, ttlMs?: number) {
        const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
        this.store.set(key, { value, expiresAt });
    }

    delete(key: string) {
        this.store.delete(key);
    }

    clear() {
        this.store.clear();
    }

    clearPrefix(prefix: string) {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
            }
        }
    }
}
