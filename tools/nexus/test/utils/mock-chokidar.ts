class MockWatcher {
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, handler: (...args: any[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
    if (event === 'ready') {
      setImmediate(() => handler());
    }
    return this;
  }

  async close() {
    this.listeners.clear();
  }

  async emit(event: string, ...args: any[]) {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers) {
      await handler(...args);
    }
  }

  getListeners() {
    return this.listeners;
  }
}

export const instances: MockWatcher[] = [];

const chokidarMock = {
  watch: jest.fn(() => {
    const watcher = new MockWatcher();
    instances.push(watcher);
    return watcher;
  })
};

export default chokidarMock;
