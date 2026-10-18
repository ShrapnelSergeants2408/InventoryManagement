// Live camera with barcode/QR detection (F21; mockups 5a, 5e). Used by Scan and by the
// editor's barcode field. The camera is released when the screen closes or the app is hidden.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getDetector } from '../../io/barcode';

export type CameraState = 'starting' | 'live' | 'denied' | 'nocamera' | 'error';

/** A code seen again this soon after it was reported is ignored (the label is still in view). */
export const REPEAT_IGNORE_MS = 2500;
const SCAN_EVERY_MS = 200;

export function Scanner(props: {
  /** While paused the camera stays on but nothing is reported (a result is on screen). */
  paused: boolean;
  onDetect: (code: string, format: string) => void;
  onState?: (s: CameraState) => void;
  /** Turns the torch on or off, where the camera has one. */
  torch?: boolean;
  onTorchSupport?: (supported: boolean) => void;
  children?: ComponentChildren;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setStateRaw] = useState<CameraState>('starting');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const latest = useRef(props);
  latest.current = props;
  const last = useRef<{ code: string; at: number } | null>(null);

  const setState = (s: CameraState) => {
    setStateRaw(s);
    latest.current.onState?.(s);
  };

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Open the camera while the screen is shown and the app is visible.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let s: MediaStream | null = null;
    setState('starting');
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setState('nocamera');
      return;
    }
    md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }).then(
      (got) => {
        if (!alive) return got.getTracks().forEach((t) => t.stop());
        s = got;
        setStream(got);
        const track = got.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        latest.current.onTorchSupport?.(caps.torch === true);
        setState('live');
      },
      (e: unknown) => {
        if (!alive) return;
        const name = (e as { name?: string }).name;
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocamera' : 'error');
      },
    );
    return () => {
      alive = false;
      s?.getTracks().forEach((t) => t.stop());
      setStream(null);
      latest.current.onTorchSupport?.(false);
    };
  }, [visible]);

  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!track || props.torch === undefined) return;
    void track.applyConstraints({ advanced: [{ torch: props.torch } as MediaTrackConstraintSet] }).catch(() => {});
  }, [stream, props.torch]);

  // Look for codes a few times a second while live and not paused.
  useEffect(() => {
    if (state !== 'live' || props.paused) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      const v = video.current;
      try {
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          const found = await (await getDetector()).detect(v);
          const hit = found.find((f) => f.rawValue.trim() !== '');
          if (alive && hit) {
            const now = Date.now();
            const prev = last.current;
            if (!(prev && prev.code === hit.rawValue && now - prev.at < REPEAT_IGNORE_MS)) {
              last.current = { code: hit.rawValue, at: now };
              latest.current.onDetect(hit.rawValue, hit.format);
              return;
            }
            last.current = { code: hit.rawValue, at: prev!.at };
          }
        }
      } catch {
        // A frame that can't be read is skipped.
      }
      if (alive) timer = window.setTimeout(() => void tick(), SCAN_EVERY_MS);
    };
    // Resuming: the code just handled is ignored for a moment, counted from now.
    if (last.current) last.current = { ...last.current, at: Date.now() };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [state, props.paused]);

  return (
    <div class={props.paused ? 'cam paused' : 'cam'} data-state={state}>
      <video ref={video} class="cam-v" playsInline muted autoPlay aria-hidden="true" />
      {props.children}
    </div>
  );
}
