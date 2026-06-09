export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 把划选的客户端矩形（屏幕坐标）换算成相对页面的百分比矩形（0~1），
 * 与缩放无关，便于持久化后在任意 scale 下还原。丢弃零面积矩形，
 * 以及明显落在该页之外（跨页选区残留）的矩形。
 */
export function toPageRects(clientRects: Box[], pageRect: Box): PageRect[] {
  if (pageRect.width <= 0 || pageRect.height <= 0) return [];
  return clientRects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: (r.left - pageRect.left) / pageRect.width,
      y: (r.top - pageRect.top) / pageRect.height,
      w: r.width / pageRect.width,
      h: r.height / pageRect.height,
    }))
    .filter((r) => r.y > -0.05 && r.y < 1.05);
}
