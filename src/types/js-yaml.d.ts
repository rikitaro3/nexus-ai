declare module 'js-yaml' {
  interface DumpOptions {
    lineWidth?: number;
  }

  export function load(content: string): unknown;
  export function dump(value: unknown, options?: DumpOptions): string;

  const yaml: {
    load: typeof load;
    dump: typeof dump;
  };

  export default yaml;
}
