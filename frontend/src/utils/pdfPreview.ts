export const getMaximizedPdfPreviewUrl = (fileUrl: string) => {
  if (!fileUrl) return '';

  const [baseUrl, fragment = ''] = fileUrl.split('#');
  const params = new URLSearchParams(fragment);

  params.set('toolbar', '0');
  params.set('navpanes', '0');
  params.set('scrollbar', '0');
  params.set('pagemode', 'none');
  params.set('view', 'FitH');
  params.set('zoom', 'page-width');

  return `${baseUrl}#${params.toString()}`;
};
