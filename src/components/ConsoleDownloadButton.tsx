'use client';

import { useEffect, useRef } from 'react';

export default function ConsoleDownloadButton() {
  const logBufferRef = useRef<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const buffer = logBufferRef.current;
    const original = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info?.bind(console),
    };

    function wrap(type: 'log' | 'error' | 'warn' | 'info') {
      return (...args: unknown[]) => {
        const label = type.toUpperCase();
        const message = args
          .map(arg => {
            if (typeof arg === 'string') return arg;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(' ');
        buffer.push(`[${label}] ${message}`);
        (original[type] ?? original.log)(...args);
      };
    }

    console.log = wrap('log');
    console.error = wrap('error');
    console.warn = wrap('warn');
    if (console.info) {
      console.info = wrap('info');
    }

    return () => {
      console.log = original.log;
      console.error = original.error;
      console.warn = original.warn;
      if (console.info && original.info) {
        console.info = original.info;
      }
    };
  }, []);

  const handleDownload = () => {
    const entries = logBufferRef.current;
    const blob = new Blob([entries.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `nexus-console-${new Date().toISOString().replace(/:/g, '-')}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={handleDownload}
      data-testid="app-shell__download-console-button"
    >
      📋 Console Logをダウンロード
    </button>
  );
}
