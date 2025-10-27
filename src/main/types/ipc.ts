import { IpcMainInvokeEvent } from 'electron';

/**
 * 統一APIレスポンス形式
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Docs API
 */
export interface DocsAPI {
  read(relPath: string): Promise<ApiResponse<string>>;
  open(relPath: string): Promise<ApiResponse<void>>;
}

/**
 * Tasks API
 */
export interface TasksAPI {
  readJson(): Promise<ApiResponse<any>>;
  writeJson(data: any): Promise<ApiResponse<void>>;
  appendMdc(relPath: string, content: string): Promise<ApiResponse<void>>;
  recordRecommendationSelection(data: any): Promise<ApiResponse<void>>;
  readRecommendationHistory(): Promise<ApiResponse<any>>;
}

/**
 * Environment API
 */
export interface EnvAPI {
  isDebug(): Promise<ApiResponse<boolean>>;
}

/**
 * IPC event handler type
 */
export type IpcHandler<T = any, R = ApiResponse<any>> = (
  event: IpcMainInvokeEvent,
  ...args: T[]
) => Promise<R>;

