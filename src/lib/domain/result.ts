export type ResultState<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'err'; readonly error: E };

/**
 * 汎用的な成功 / 失敗判定を行うためのResultクラス。
 * API層だけでなく、サービス層でも共通的に利用できるようにしています。
 */
export class Result<T, E = Error> {
  private constructor(private readonly state: ResultState<T, E>) {}

  static ok<T>(value: T): Result<T, never> {
    return new Result<T, never>({ kind: 'ok', value });
  }

  static err<E>(error: E): Result<never, E> {
    return new Result<never, E>({ kind: 'err', error });
  }

  static fromNullable<T, E>(value: T | null | undefined, error: E): Result<T, E> {
    return value == null
      ? new Result<T, E>({ kind: 'err', error })
      : new Result<T, E>({ kind: 'ok', value });
  }

  static async fromPromise<T, E = Error>(promise: Promise<T>, mapError?: (error: unknown) => E): Promise<Result<T, E>> {
    try {
      const value = await promise;
      return new Result<T, E>({ kind: 'ok', value });
    } catch (error: unknown) {
      const mapped = mapError ? mapError(error) : (error as E);
      return new Result<T, E>({ kind: 'err', error: mapped });
    }
  }

  isOk(): boolean {
    return this.state.kind === 'ok';
  }

  isErr(): boolean {
    return this.state.kind === 'err';
  }

  unwrap(): T {
    if (this.isOk()) {
      return this.state.value;
    }

    throw this.state.error;
  }

  unwrapOr(defaultValue: T): T {
    return this.isOk() ? this.state.value : defaultValue;
  }

  unwrapErr(): E {
    if (this.isErr()) {
      return this.state.error;
    }

    throw new Error('Resultが成功状態のため、エラーを取り出せません。');
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    if (this.isOk()) {
      return new Result<U, E>({ kind: 'ok', value: fn(this.state.value) });
    }

    return new Result<U, E>({ kind: 'err', error: this.state.error });
  }

  mapError<F>(fn: (error: E) => F): Result<T, F> {
    if (this.isErr()) {
      return new Result<T, F>({ kind: 'err', error: fn(this.state.error) });
    }

    return new Result<T, F>({ kind: 'ok', value: this.state.value });
  }

  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return this.isOk() ? handlers.ok(this.state.value) : handlers.err(this.state.error);
  }
}
