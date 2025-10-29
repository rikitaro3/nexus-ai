declare module 'chokidar' {
  export interface WatchOptions {
    persistent?: boolean;
    ignoreInitial?: boolean;
    awaitWriteFinish?: {
      stabilityThreshold?: number;
      pollInterval?: number;
    };
    [key: string]: unknown;
  }

  export interface FSWatcher {
    on(event: 'add', listener: (path: string) => void): FSWatcher;
    on(event: 'change', listener: (path: string) => void): FSWatcher;
    on(event: 'unlink', listener: (path: string) => void): FSWatcher;
    on(event: 'ready', listener: () => void): FSWatcher;
    on(event: 'error', listener: (error: Error) => void): FSWatcher;
    on(event: string, listener: (...args: unknown[]) => void): FSWatcher;
    close(): Promise<void>;
    add?(paths: string | string[]): FSWatcher;
    unwatch?(paths: string | string[]): FSWatcher;
  }

  export function watch(paths: string | string[], options?: WatchOptions): FSWatcher;

  const chokidar: {
    watch: typeof watch;
  };

  export default chokidar;
}
