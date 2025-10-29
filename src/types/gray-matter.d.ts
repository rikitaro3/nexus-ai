declare module 'gray-matter' {
  export interface GrayMatterFile<T = Record<string, unknown>> {
    data: T;
    content: string;
    excerpt?: string;
    orig: Buffer | string;
    language: string;
    matter: string;
    stringify(lang: string): string;
  }

  export interface GrayMatterOption<T = Record<string, unknown>> {
    excerpt?: boolean | ((file: GrayMatterFile<T>, options: GrayMatterOption<T>) => string);
    excerpt_separator?: string;
    engines?: Record<string, (input: string) => object>;
    language?: string;
    delimiters?: string | [string, string];
  }

  function matter<T = Record<string, unknown>>(input: string | Buffer, options?: GrayMatterOption<T>): GrayMatterFile<T>;

  export default matter;
}

