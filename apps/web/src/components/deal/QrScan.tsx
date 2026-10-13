'use client';

import { QrCode } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { addressFromQr } from '@/lib/qr';
import { Notice } from '../ui/Notice';
import { Sheet } from '../ui/Sheet';

type Detector = { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** Scans a wallet's receive QR code with the camera. Shown only where the browser can decode QR codes. */
export function QrScanButton({ onAddress }: { onAddress: (a: Address) => void }) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setSupported('BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia), []);
  if (!supported) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-raised px-3 text-[13px] font-medium">
        <QrCode className="size-4" /> Scan
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Scan their wallet QR">
        {open && (
          <Scanner
            onAddress={(a) => {
              onAddress(a);
              setOpen(false);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function Scanner({ onAddress }: { onAddress: (a: Address) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const found = useRef(onAddress);
  found.current = onAddress;
  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          if (!video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          for (const c of codes) {
            const a = addressFromQr(c.rawValue);
            if (a) return found.current(a);
          }
        }, 250);
      } catch {
        setError('Camera access was blocked. Allow the camera for this site, or paste the address instead.');
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return error ? (
    <Notice tone="warn" title="Can't use the camera">{error}</Notice>
  ) : (
    <div className="space-y-3">
      <video ref={video} muted playsInline className="aspect-square w-full rounded-[16px] bg-ink object-cover" />
      <p className="text-sm text-muted">Ask your plug to open Receive in their wallet app and point your camera at the QR code.</p>
    </div>
  );
}
