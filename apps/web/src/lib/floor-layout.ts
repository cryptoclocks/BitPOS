/** Default placement for the shop floor plan when a merchant has not dragged a node yet.
 * Tables sit in rows of three at the top; screens follow in rows of three below them with a 125 px pitch,
 * and the canvas grows with the number of rows, so default slots never stack. Percentages are of the canvas. */
export const FLOOR_BASE_HEIGHT = 440, FLOOR_DEVICE_PITCH = 125, FLOOR_TABLE_PITCH = 120;
export type FloorPoint = { x: number; y: number };
export function floorLayout(tableCount: number, deviceCount: number) {
  const tableRows = Math.min(3, Math.ceil(tableCount / 3));
  const deviceTop = tableRows === 0 ? 150 : Math.max(290, 150 + (tableRows - 1) * FLOOR_TABLE_PITCH + 130);
  const height = Math.max(FLOOR_BASE_HEIGHT, deviceTop + 70 + (Math.max(1, Math.ceil(deviceCount / 3)) - 1) * FLOOR_DEVICE_PITCH);
  return {
    height,
    table: (i: number): FloorPoint => ({ x: 26 + i % 3 * 27, y: (150 + Math.floor(i / 3) % 3 * FLOOR_TABLE_PITCH) / height * 100 }),
    device: (i: number): FloorPoint => ({ x: 39 + i % 3 * 23, y: (deviceTop + Math.floor(i / 3) * FLOOR_DEVICE_PITCH) / height * 100 }),
  };
}
