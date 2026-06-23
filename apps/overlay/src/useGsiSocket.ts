import { useEffect, useState } from 'react';
import type { NormalizedState } from '@dc/shared';

export function useGsiSocket(url = 'ws://127.0.0.1:53000/ws') {
  const [state, setState] = useState<NormalizedState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        // The listener only sends NormalizedState objects; cast is safe as long as server contract holds.
        try { setState(JSON.parse(ev.data as string) as NormalizedState); } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, [url]);

  return { state, connected };
}
