import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../types';
import { normalizeState, STATE_VERSION, type StoredState } from '../shared/state';

vi.mock('./cloud', () => ({ CLOUD_ENABLED: true }));
vi.mock('./auth', () => ({ getAuthToken: () => 'token' }));

const { createCloudStorage } = await import('./cloudStorage');

const NAME = 'ledger-tasks-v2';

function task(id: string, updatedAt: number, title = id): Task {
  return {
    id,
    project: 'p',
    title,
    status: 'todo',
    priority: 'med',
    dueDate: '2026-11-10',
    subs: [],
    recurring: null,
    deps: [],
    notes: '',
    order: 0,
    updatedAt,
  };
}

const stored = (tasks: Task[]): StoredState => ({ state: normalizeState({ tasks }), version: STATE_VERSION });

let store: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('cloud storage sync', () => {
  it('keeps an offline edit when reloading against a stale cloud copy, then uploads it', async () => {
    const storage = createCloudStorage<unknown>();

    // Edit while offline: saved locally, upload fails, pending flag stays set.
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    storage.setItem(NAME, stored([task('a', 200, 'edited offline')]) as never);
    await vi.advanceTimersByTimeAsync(500);
    expect(store.get('ledger-sync-pending')).toBe('1');

    // Reload online: the cloud still has the older copy.
    fetchMock.mockImplementation((_url, init) =>
      init?.method === 'POST' ? json(JSON.parse(init.body as string)) : json(stored([task('a', 100, 'old')])),
    );
    const loaded = (await storage.getItem(NAME)) as unknown as StoredState;
    expect(loaded.state.tasks[0].title).toBe('edited offline');

    await vi.advanceTimersByTimeAsync(10);
    const sent = JSON.parse(posts().at(-1)![1].body as string) as StoredState;
    expect(sent.state.tasks[0].title).toBe('edited offline');
    expect(store.get('ledger-sync-pending')).toBeUndefined();
  });

  it("brings in another device's edits returned by the server after an upload", async () => {
    const storage = createCloudStorage<unknown>();
    fetchMock.mockImplementation(() => json(stored([task('a', 100), task('b', 300, 'from other device')])));
    storage.setItem(NAME, stored([task('a', 100)]) as never);
    await vi.advanceTimersByTimeAsync(500);
    const local = JSON.parse(store.get(NAME)!) as StoredState;
    expect(local.state.tasks.map((t) => t.title).sort()).toEqual(['a', 'from other device']);
  });

  it('seeds an empty cloud from this browser', async () => {
    const storage = createCloudStorage<unknown>();
    store.set(NAME, JSON.stringify(stored([task('a', 1)])));
    fetchMock.mockImplementation((_url, init) => (init?.method === 'POST' ? json(stored([task('a', 1)])) : json(null)));
    await storage.getItem(NAME);
    await vi.advanceTimersByTimeAsync(10);
    expect(posts()).toHaveLength(1);
  });
});
