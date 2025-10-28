import { z } from 'zod';

/**
 * 共通的に利用するIDスキーマ。
 */
export const idSchema = z
  .string()
  .min(1, 'IDは必須です。')
  .max(191, 'IDは191文字以内で指定してください。');

/**
 * ISO8601形式の日時を検証するスキーマ。
 */
export const isoDateTimeSchema = z
  .string()
  .datetime({ message: 'ISO8601形式の日時を指定してください。' });

/**
 * ページングに利用する共通パラメーター。
 */
export const paginationSchema = z.object({
  page: z
    .coerce
    .number({ message: 'pageは数値で指定してください。' })
    .int('pageは整数で指定してください。')
    .min(1, 'pageは1以上で指定してください。')
    .default(1),
  limit: z
    .coerce
    .number({ message: 'limitは数値で指定してください。' })
    .int('limitは整数で指定してください。')
    .min(1, 'limitは1以上で指定してください。')
    .max(100, 'limitは100以下で指定してください。')
    .default(20),
});

/**
 * 検索クエリで利用する短い文字列用のスキーマ。
 */
export const querySchema = z.string().max(255, '検索キーワードは255文字以内で入力してください。').optional();

export const withTimestampsSchema = z.object({
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
