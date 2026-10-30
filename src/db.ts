import { resource } from './fivem';
import { FileStore } from './store/file';
import { MysqlStore } from './store/mysql';
import type { Store } from './store/types';

let current: Store | undefined;

export function db(): Store {
    if (!current) throw new Error('store not open yet');
    return current;
}

export function useStore(store: Store) {
    current = store;
}

// Use oxmysql when the server has it. If it's installed but still starting, wait for it.
export async function openStore(): Promise<Store> {
    let state = GetResourceState('oxmysql');
    for (let i = 0; i < 30 && (state === 'starting' || state === 'stopped'); i++) {
        await new Promise((r) => setTimeout(r, 500));
        state = GetResourceState('oxmysql');
    }

    const store: Store =
        state === 'started'
            ? new MysqlStore()
            : new FileStore(
                  () => LoadResourceFile(resource, 'data.json'),
                  (text) => SaveResourceFile(resource, 'data.json', text, -1),
                  (text) => SaveResourceFile(resource, 'data.broken.json', text, -1),
              );

    await store.init();
    current = store;
    return store;
}
