export type PositionCapabilitySaveValues = Record<string, unknown> & {
  capability_dimensions?: unknown[];
};

/** Build a position-only save payload; capability descriptions never fan out to other positions. */
export function buildPositionCapabilitySave(values: PositionCapabilitySaveValues) {
  const payload: Record<string, unknown> = { ...values };
  if ('capability_dimensions' in payload) {
    payload.capability_dimensions = JSON.stringify(
      Array.isArray(values.capability_dimensions) ? values.capability_dimensions : [],
    );
  }
  return {
    payload,
    crossPositionUpdates: [] as const,
  };
}
