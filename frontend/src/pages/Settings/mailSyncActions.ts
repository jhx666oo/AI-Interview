export type MailSyncRequest = {
  post: (path: string, body: { configId: string }) => Promise<unknown>;
};

export async function cancelMailSync(
  request: MailSyncRequest,
  configIds: string[],
): Promise<string[]> {
  const uniqueConfigIds = [...new Set(configIds)];
  await Promise.all(
    uniqueConfigIds.map((configId) => request.post('/mail/sync/cancel', { configId })),
  );
  return uniqueConfigIds;
}
