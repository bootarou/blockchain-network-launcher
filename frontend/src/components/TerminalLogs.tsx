import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Terminal as TerminalIcon, Trash2, ArrowDown } from 'lucide-react';

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `ws://${window.location.hostname}:4000`;

export function TerminalLogs() {
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── WebSocket lifecycle ────────────────────────────────────────────────

  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        if (!disposed) setConnected(true);
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        retryTimer = setTimeout(connect, 3000); // auto-reconnect
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'LOG') {
            setLogs((prev) => [...prev, msg.data].slice(-2000));
          }
        } catch {
          // ignore malformed messages
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  // ── Auto-scroll ────────────────────────────────────────────────────────

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  // ── Clear ──────────────────────────────────────────────────────────────

  const clearLogs = () => setLogs([]);

  return (
    <div className="bg-black/90 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[400px]">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3">
        <TerminalIcon className="w-4 h-4 text-zinc-400" />
        <span className="text-sm font-medium text-zinc-300">symbol-bootstrap terminal</span>

        {/* Connection indicator */}
        <span
          className={`ml-2 w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />

        <div className="ml-auto flex items-center gap-2">
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
            >
              <ArrowDown className="w-3 h-3" /> Scroll to bottom
            </button>
          )}
          <button
            onClick={clearLogs}
            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Clear logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="p-4 flex-1 overflow-y-auto font-mono text-xs text-green-400 space-y-0.5"
      >
        {logs.length === 0 ? (
          <div className="text-zinc-600 italic">Waiting for logs...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="break-all whitespace-pre-wrap leading-relaxed">
              {log}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
