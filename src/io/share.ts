// Sending a file off the tablet (F13, F15, spec-questions Q1): Android's share sheet when the
// browser can share that file, otherwise a download to the Downloads folder.

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

export interface ShareDeps {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download: (file: File) => void;
}

function browserDeps(): ShareDeps {
  return {
    canShare: typeof navigator.canShare === 'function' ? (d) => navigator.canShare(d) : undefined,
    share: typeof navigator.share === 'function' ? (d) => navigator.share(d) : undefined,
    download: downloadFile,
  };
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Opens the share sheet when the file can be shared; closing the sheet is 'cancelled'.
 * If sharing isn't possible (or fails for another reason), the file is downloaded instead.
 */
export async function shareOrDownload(file: File, title: string, deps: ShareDeps = browserDeps()): Promise<ShareResult> {
  const data: ShareData = { files: [file], title };
  if (deps.share && deps.canShare?.(data)) {
    try {
      await deps.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // NotAllowedError (no user gesture) and the like: fall back to a download.
    }
  }
  deps.download(file);
  return 'downloaded';
}
