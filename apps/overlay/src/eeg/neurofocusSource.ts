/**
 * NeuroFocus V4 EEG source over Web Bluetooth.
 *
 * Talks to the firmware in ../../../neurofocus/firmware/v4:
 *   service        0338ff7c-6251-4029-a5d5-24e4fa856c8d
 *   data char      ad615f2b-cc93-4155-9e4d-f5f32cb9a2d7  (READ + NOTIFY)
 *   command char   b5e3d1c9-8a2f-4e7b-9c6d-1a3f5e7b9c2d  (WRITE)  ·  'b' start / 's' stop / 'v' reset
 *   device name    NEUROFOCUS_V4*  ·  ADS1220 single channel, 600 SPS, signed 24-bit counts
 *
 * Wire format (config.h `BLE_DATA_MODE`) — the shipped firmware default is
 * BINARY_BATCH, so we parse that first and fall back to the ASCII variants:
 *   - BINARY_BATCH  : [0xE7 0x1E][seq u16 LE][n u8][n × i32 LE counts]  (8 samples/frame)
 *   - ASCII_BATCH   : "#<startIndex>,<overflow> v1 v2 …\n"  (space-separated, '#' header)
 *   - ASCII_LEGACY  : one decimal integer per notify
 *
 * We emit raw signed counts; the focus/stress math lives in @dc/shared (eeg.ts).
 * This file only handles transport, so it stays out of the tested pure core.
 */

export const NF_SERVICE_UUID = '0338ff7c-6251-4029-a5d5-24e4fa856c8d';
export const NF_CHARACTERISTIC_UUID = 'ad615f2b-cc93-4155-9e4d-f5f32cb9a2d7';
export const NF_CMD_CHARACTERISTIC_UUID = 'b5e3d1c9-8a2f-4e7b-9c6d-1a3f5e7b9c2d';
export const NF_NAME_PREFIX = 'NEUROFOCUS';

const FRAME_MAGIC0 = 0xe7;
const FRAME_MAGIC1 = 0x1e;
const MAX_BYTE_BUFFER = 8192; // resync guard: never hoard more than this many undecoded bytes

// Minimal Web Bluetooth shape — avoids a @types/web-bluetooth dependency.
interface BleChar {
  startNotifications(): Promise<BleChar>;
  stopNotifications(): Promise<BleChar>;
  writeValue(data: BufferSource): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', cb: (e: Event) => void): void;
  value?: DataView;
}
interface BleService {
  getCharacteristic(uuid: string): Promise<BleChar>;
}
interface BleDevice {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<BleService> }>;
    disconnect(): void;
  };
  addEventListener(type: 'gattserverdisconnected', cb: () => void): void;
}
interface BleNavigator {
  bluetooth?: {
    requestDevice(opts: {
      filters?: { namePrefix?: string; services?: string[] }[];
      optionalServices?: string[];
    }): Promise<BleDevice>;
  };
}

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as BleNavigator).bluetooth;
}

export type SampleHandler = (rawCount: number) => void;
export type StatusHandler = (status: NeuroFocusStatus) => void;
export type NeuroFocusStatus = 'idle' | 'connecting' | 'streaming' | 'error' | 'disconnected';
type WireMode = 'unknown' | 'binary' | 'ascii';

export class NeuroFocusSource {
  private device: BleDevice | null = null;
  private char: BleChar | null = null;
  private cmd: BleChar | null = null;
  private decoder = new TextDecoder();
  private wire: WireMode = 'unknown';
  private bytes = new Uint8Array(0); // rolling byte buffer for binary frames
  private tail = '';                  // rolling text tail for ASCII frames
  deviceName: string | null = null;
  status: NeuroFocusStatus = 'idle';

  constructor(
    private readonly onSample: SampleHandler,
    private readonly onStatus: StatusHandler = () => {},
  ) {}

  private set(status: NeuroFocusStatus): void {
    this.status = status;
    this.onStatus(status);
  }

  private reset(): void {
    this.wire = 'unknown';
    this.bytes = new Uint8Array(0);
    this.tail = '';
  }

  async connect(): Promise<void> {
    const bt = (navigator as unknown as BleNavigator).bluetooth;
    if (!bt) { this.set('error'); throw new Error('Web Bluetooth not available in this environment.'); }
    this.set('connecting');
    this.reset();
    try {
      const device = await bt.requestDevice({
        filters: [{ namePrefix: NF_NAME_PREFIX }],
        optionalServices: [NF_SERVICE_UUID],
      });
      this.device = device;
      this.deviceName = device.name ?? 'NeuroFocus';
      device.addEventListener('gattserverdisconnected', () => this.set('disconnected'));

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(NF_SERVICE_UUID);
      const char = await service.getCharacteristic(NF_CHARACTERISTIC_UUID);
      this.char = char;
      char.addEventListener('characteristicvaluechanged', (e) => this.onNotify(e));
      await char.startNotifications();

      // Commands go on a SEPARATE characteristic (the data char is notify-only). The
      // firmware auto-starts streaming on connect, so this is belt-and-suspenders.
      try { this.cmd = await service.getCharacteristic(NF_CMD_CHARACTERISTIC_UUID); } catch { this.cmd = null; }
      try { await (this.cmd ?? char).writeValue(new TextEncoder().encode('b')); } catch { /* notify-only / no cmd char */ }
      this.set('streaming');
    } catch (err) {
      this.set('error');
      throw err;
    }
  }

  private onNotify(e: Event): void {
    const target = e.target as unknown as { value?: DataView };
    const dv = target.value;
    if (!dv) return;
    const chunk = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    if (chunk.length === 0) return;

    if (this.wire === 'unknown') {
      // The shipped firmware default is BINARY_BATCH; detect it by the frame magic,
      // otherwise treat the stream as ASCII (batch or legacy).
      this.wire = (chunk.length >= 2 && chunk[0] === FRAME_MAGIC0 && chunk[1] === FRAME_MAGIC1) ? 'binary' : 'ascii';
    }
    if (this.wire === 'binary') this.parseBinary(chunk);
    else this.parseAscii(chunk);
  }

  /** [0xE7 0x1E][seq u16 LE][n u8][n × i32 LE] — frames may split/coalesce across notifies. */
  private parseBinary(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.bytes.length + chunk.length);
    merged.set(this.bytes, 0);
    merged.set(chunk, this.bytes.length);
    const dv = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);

    let off = 0;
    while (merged.length - off >= 5) {
      if (merged[off] !== FRAME_MAGIC0 || merged[off + 1] !== FRAME_MAGIC1) {
        off++;               // resync: hunt for the next frame boundary
        continue;
      }
      const n = merged[off + 4]!;
      const frameLen = 5 + n * 4;
      if (merged.length - off < frameLen) break; // wait for the rest of this frame
      for (let i = 0; i < n; i++) {
        this.onSample(dv.getInt32(off + 5 + i * 4, true));
      }
      off += frameLen;
    }
    // Keep the unparsed remainder; drop it if a desync lets it grow without bound.
    const rest = merged.subarray(off);
    this.bytes = rest.length > MAX_BYTE_BUFFER ? rest.slice(rest.length - 2) : rest.slice();
  }

  /** Space-separated integers; a "#<start>,<overflow>" header token (if present) is skipped. */
  private parseAscii(chunk: Uint8Array): void {
    const text = this.tail + this.decoder.decode(chunk);
    const parts = text.split(/\s+/);
    this.tail = parts.pop() ?? '';           // last token may be partial — carry it over
    for (const p of parts) {
      if (p === '' || p[0] === '#') continue; // '#…' is the frame-index header, not a sample
      const v = Number.parseInt(p, 10);
      if (Number.isFinite(v)) this.onSample(v);
    }
    if (this.tail.length > 64) this.tail = ''; // never let a broken token grow unbounded
  }

  async disconnect(): Promise<void> {
    try { await (this.cmd ?? this.char)?.writeValue(new TextEncoder().encode('s')); } catch { /* ignore */ }
    try { await this.char?.stopNotifications(); } catch { /* ignore */ }
    try { this.device?.gatt?.disconnect(); } catch { /* ignore */ }
    this.char = null;
    this.cmd = null;
    this.device = null;
    this.reset();
    this.set('idle');
  }
}
