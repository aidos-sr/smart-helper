const memory = new Map();
function backend() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
export const safeStorage = {
  durable: true,
  getItem(key) {
    try {
      return memory.get(key) ?? backend()?.getItem(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key, value) {
    try {
      const store = backend();
      if (!store) throw new Error();
      store.setItem(key, String(value));
      memory.delete(key);
      this.durable = true;
      return true;
    } catch {
      memory.set(key, String(value));
      this.durable = false;
      return false;
    }
  },
  removeItem(key) {
    memory.delete(key);
    try {
      backend()?.removeItem(key);
    } catch {}
  },
  keys() {
    try {
      return [...new Set([...Object.keys(backend() || {}), ...memory.keys()])];
    } catch {
      return [...memory.keys()];
    }
  },
};
export function readJSON(key, fallback) {
  try {
    return JSON.parse(safeStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
