/** Decode DST's dynamic atlas package without changing its on-disk asset path. */
export function decodeDyn(data: Uint8Array): Uint8Array {
  const order = [6, 7, 5, 1, 4, 0, 2, 3];
  const decoded = Uint8Array.from(data);
  // The final 1–8 bytes are stored verbatim, including a complete final block.
  for (let offset = 0; offset + order.length < data.length; offset += order.length) {
    for (let index = 0; index < order.length; index++) {
      const target = order[index];
      decoded[offset + target] = data[offset + index] ^ (141 + target);
    }
  }
  if (decoded[0] !== 0x50 || decoded[1] !== 0x4b || decoded[2] !== 3 || decoded[3] !== 4) {
    throw new Error('Invalid DST dynamic atlas package');
  }
  return decoded;
}
