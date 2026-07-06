/**
 * NeuroFocus V4 EEG source over Web Bluetooth.
 *
 * Talks to the firmware in ../../../neurofocus/firmware/v4:
 *   service        0338ff7c-6251-4029-a5d5-24e4fa856c8d
 *   characteristic ad615f2b-cc93-4155-9e4d-f5f32cb9a2d7  (notify + write)
 *   device name    NEUROFOCUS*  ·  commands: 'b' start, 's' stop, 'v' reset
 *   payload        ASCII integers = ADS1220 raw counts (single channel, ~250 Hz)
 *
 * We emit raw counts; the focus/stress math lives in @dc/shared (eeg.ts). This
 * file only handles transport, so it stays out of the tested pure core.
 */

export const NF_SERVICE_UUID = '0338ff7c-6251-4029-a5d5-24e4fa856c8d';
export const NF_CHARACTERISTIC_UUID = 'ad615f2b-cc93-4155-9e4d-f5f32cb9a2d7';
export const NF_NAME_PREFIX = 'NEUROFOCUS';

// Minimal Web Bluetooth shape — avoids a @types/web-bluetooth dependency.
interface BleChar {
  startNotifications(): Promise<BleChar>;
  stopNotifications(): Promise<BleChar>;
  writeValue(data: BufferSource): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', cb: (e: Event) => void): void;
  value?: DataView;
}
interface BleDevice {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleChar> }> }>;
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

export class NeuroFocusSource {
  private device: BleDevice | null = null;
  private char: BleChar | null = null;
  private decoder = new TextDecoder();
  private tail = '';
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

  async connect(): Promise<void> {
    const bt = (navigator as unknown as BleNavigator).bluetooth;
    if (!bt) { this.set('error'); throw new Error('Web Bluetooth not available in this environment.'); }
    this.set('connecting');
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
      // Firmware auto-starts on connect, but send 'b' to be explicit. Ignore if
      // the characteristic is notify-only.
      try { await char.writeValue(new TextEncoder().encode('b')); } catch { /* notify-only */ }
      this.set('streaming');
    } catch (err) {
      this.set('error');
      throw err;
    }
  }

  private onNotify(e: Event): void {
    const target = e.target as unknown as { value?: DataView };
    if (!target.value) return;
    // ASCII integers, possibly split across notifies — buffer the tail.
    const text = this.tail + this.decoder.decode(target.value.buffer);
    const parts = text.split(/[^\d-]+/);
    // Keep the last (possibly partial) token for the next notify.
    this.tail = parts.pop() ?? '';
    for (const p of parts) {
      if (p === '' || p === '-') continue;
      const n = Number.parseInt(p, 10);
      if (Number.isFinite(n)) this.onSample(n);
    }
  }

  async disconnect(): Promise<void> {
    try { await this.char?.writeValue(new TextEncoder().encode('s')); } catch { /* ignore */ }
    try { await this.char?.stopNotifications(); } catch { /* ignore */ }
    try { this.device?.gatt?.disconnect(); } catch { /* ignore */ }
    this.char = null;
    this.device = null;
    this.set('idle');
  }
}
