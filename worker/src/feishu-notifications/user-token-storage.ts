export interface RefreshedUserToken {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  updatedAt: string;
}

function isMissingFailedAtColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column:\s*feishu_token_failed_at|has no column named feishu_token_failed_at/i.test(message);
}

export async function markUserTokenRefreshFailed(
  db: D1Database,
  email: string,
  failedAt: string,
): Promise<void> {
  try {
    await db.prepare('UPDATE users SET feishu_token_failed_at = ? WHERE email = ?')
      .bind(failedAt, email).run();
  } catch (error) {
    if (!isMissingFailedAtColumn(error)) throw error;
  }
}

export async function saveRefreshedUserToken(
  db: D1Database,
  token: RefreshedUserToken,
): Promise<void> {
  try {
    await db.prepare(
      'UPDATE users SET feishu_token = ?, feishu_refresh_token = ?, feishu_token_expires_at = ?, feishu_token_failed_at = NULL, updated_at = ? WHERE email = ?',
    ).bind(token.accessToken, token.refreshToken, token.expiresAt, token.updatedAt, token.email).run();
    return;
  } catch (error) {
    if (!isMissingFailedAtColumn(error)) throw error;
  }

  await db.prepare(
    'UPDATE users SET feishu_token = ?, feishu_refresh_token = ?, feishu_token_expires_at = ?, updated_at = ? WHERE email = ?',
  ).bind(token.accessToken, token.refreshToken, token.expiresAt, token.updatedAt, token.email).run();
}
