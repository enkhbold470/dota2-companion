import { describe, it, expect } from 'vitest';
import { NeuroFocusSource } from './neurofocusSource';

/** Build a BINARY_BATCH frame: [E7 1E][seq u16 LE][n u8][n × i32 LE]. */
function frame(seq: number, counts: number[]): Uint8Array {
  const buf = new Uint8Array(5 + counts.length * 4);
  const dv = new DataView(buf.buffer);
  buf[0] = 0xe7; buf[1] = 0x1e;
  dv.setUint16(2, seq, true);
  buf[4] = counts.length;
  counts.forEach((c, i) => dv.setInt32(5 + i * 4, c, true));
  return buf;
}

/** Feed raw bytes through the private notify path exactly as Web Bluetooth would. */
function feed(src: NeuroFocusSource, bytes: Uint8Array): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  (src as unknown as { onNotify(e: Event): void }).onNotify({ target: { value: dv } } as unknown as Event);
}

function collector(): { samples: number[]; src: NeuroFocusSource } {
  const samples: number[] = [];
  const src = new NeuroFocusSource((c) => samples.push(c));
  return { samples, src };
}

describe('binary frame decoder', () => {
  it('decodes a whole frame of signed 24-bit-ish counts', () => {
    const { samples, src } = collector();
    feed(src, frame(1, [4_000_000, -12345, 8_388_607, 0]));
    expect(samples).toEqual([4_000_000, -12345, 8_388_607, 0]);
  });

  it('reassembles a frame split across two notifies', () => {
    const { samples, src } = collector();
    const f = frame(2, [100, 200, 300]);
    feed(src, f.subarray(0, 6));   // magic + seq + n + part of first sample
    expect(samples).toEqual([]);   // nothing emitted until the frame completes
    feed(src, f.subarray(6));
    expect(samples).toEqual([100, 200, 300]);
  });

  it('handles two frames coalesced into one notify', () => {
    const { samples, src } = collector();
    const merged = new Uint8Array([...frame(3, [1, 2]), ...frame(4, [3, 4])]);
    feed(src, merged);
    expect(samples).toEqual([1, 2, 3, 4]);
  });

  it('resyncs past leading garbage / a bad magic byte', () => {
    const { samples, src } = collector();
    // First notify sets wire=binary via the good magic; prepend junk to a later frame.
    feed(src, frame(5, [7]));
    feed(src, new Uint8Array([0x00, 0xff, 0x99, ...frame(6, [8, 9])]));
    expect(samples).toEqual([7, 8, 9]);
  });

  it('carries a partial trailing frame across notifies without emitting it', () => {
    const { samples, src } = collector();
    const f = frame(7, [11, 22, 33, 44]);
    feed(src, new Uint8Array([...frame(8, [1]), ...f.subarray(0, 8)]));
    expect(samples).toEqual([1]);           // only the complete frame
    feed(src, f.subarray(8));
    expect(samples).toEqual([1, 11, 22, 33, 44]);
  });
});
