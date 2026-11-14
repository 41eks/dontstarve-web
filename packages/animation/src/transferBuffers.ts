/** The buffers behind `views` that a worker can transfer: a SharedArrayBuffer is shared, never transferred. */
export function transferBuffers(views: Iterable<ArrayBufferView | undefined>): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const view of views) if (view?.buffer instanceof ArrayBuffer) buffers.push(view.buffer);
  return buffers;
}
