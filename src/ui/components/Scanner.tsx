// Live camera with barcode/QR detection (F21; mockups 5a, 5e). Used by Scan and by the
// editor's barcode field. The camera is released when the screen closes or the app is hidden.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pickAimed, stepHold, type Hold } from '../../domain/scan-aim';
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
  const box = useRef<HTMLDivElement>(null);
  const hold = useRef<Hold | null>(null);
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

  // While a code is held in the square: data-hold on the camera box (the corners turn amber)
  // and --hold (0–1), which fills a bar.
  // Set on the element directly, so the camera view doesn't re-render a few times a second.
  const showHold = (holding: boolean, progress: number) => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty('--hold', String(progress));
    if (holding) el.dataset.hold = 'on';
    else delete el.dataset.hold;
  };

  // Look for codes a few times a second while live and not paused. Only a code in the square
  // (the children's .reticle) counts, and it is used once held there for HOLD_MS (F21, F29).
  useEffect(() => {
    if (state !== 'live' || props.paused) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      const v = video.current;
      try {
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          const found = await (await getDetector()).detect(v);
          const el = box.current;
          if (alive && el) {
            const frame = el.getBoundingClientRect();
            const r = el.querySelector('.reticle')?.getBoundingClientRect();
            const aim = r ? { x: r.left - frame.left, y: r.top - frame.top, width: r.width, height: r.height } : null;
            const hit = pickAimed(found, { width: v.videoWidth, height: v.videoHeight }, { width: frame.width, height: frame.height }, aim);
            const now = Date.now();
            const prev = last.current;
            // The code just reported, still in view, is ignored for a moment.
            const fresh = hit && !(prev && prev.code === hit.rawValue && now - prev.at < REPEAT_IGNORE_MS) ? hit : null;
            const step = stepHold(hold.current, fresh?.rawValue ?? null, now);
            hold.current = step.hold;
            showHold(step.hold !== null, step.progress);
            if (step.ready && fresh) {
              hold.current = null;
              showHold(false, 0);
              last.current = { code: fresh.rawValue, at: now };
              // Scanning carries on after a report (count-in never pauses); pausing stops it.
              latest.current.onDetect(fresh.rawValue, fresh.format);
            }
          }
        }
      } catch {
        // A frame that can't be read is skipped.
      }
      if (alive) timer = window.setTimeout(() => void tick(), SCAN_EVERY_MS);
    };
    // Resuming: the code just handled is ignored for a moment, counted from now.
    if (last.current) last.current = { ...last.current, at: Date.now() };
    hold.current = null;
    showHold(false, 0);
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [state, props.paused]);

  return (
    <div ref={box} class={props.paused ? 'cam paused' : 'cam'} data-state={state}>
      <video ref={video} class="cam-v" playsInline muted autoPlay aria-hidden="true" />
      {props.children}
    </div>
  );
}
