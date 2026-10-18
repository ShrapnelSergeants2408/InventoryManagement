// Take photo / Gallery / Remove (F19, mockups 2a, 2d, 3a). The camera button opens the
// tablet camera; Gallery opens the photo picker. The picked picture is resized here
// (io/image.ts) and handed on; no PIN (§6).
import type { Ref } from 'preact';
import { useState } from 'preact/hooks';
import { preparePhoto } from '../../io/image';
import { Icon } from '../icons';
import { showToast } from '../shell/toast';

export type PreparedPhoto = { full: Blob; thumb: Blob };

export function PhotoButtons(props: {
  hasPhoto: boolean;
  /** Label of the camera button when there is a photo already. */
  retakeLabel?: string;
  small?: boolean;
  /** Lets another button (the enlarged photo's "Replace") open the camera. */
  cameraRef?: Ref<HTMLInputElement>;
  onPhoto: (photo: PreparedPhoto) => Promise<void> | void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const btn = props.small ? 'btn sm' : 'btn';

  const picked = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    // Cleared so picking the same file again still fires a change.
    input.value = '';
    if (!file || busy) return;
    setBusy(true);
    try {
      await props.onPhoto(await preparePhoto(file));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onChange = (e: Event) => void picked(e.currentTarget as HTMLInputElement);

  return (
    <div class="pacts" aria-busy={busy}>
      {/* Labels wrap the hidden inputs, so a tap opens the camera or picker directly. */}
      <label class={busy ? `${btn} disabled` : btn} aria-disabled={busy}>
        <input ref={props.cameraRef} type="file" accept="image/*" capture="environment" class="vh" disabled={busy} onChange={onChange} data-photo="camera" />
        <Icon name="camera" />
        {props.hasPhoto ? (props.retakeLabel ?? 'Retake') : 'Take photo'}
      </label>
      <label class={busy ? `${btn} disabled` : btn} aria-disabled={busy}>
        <input type="file" accept="image/*" class="vh" disabled={busy} onChange={onChange} data-photo="gallery" />
        <Icon name="gallery" />
        Gallery
      </label>
      {props.hasPhoto && (
        <button type="button" class={btn} disabled={busy} onClick={props.onRemove}>
          Remove
        </button>
      )}
      {busy && <span class="small muted" role="status">Resizing photo…</span>}
    </div>
  );
}
