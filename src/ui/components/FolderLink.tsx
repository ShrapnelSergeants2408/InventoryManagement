// A link that opens one of the team's shared Drive folders (v0.21); nothing when none is set.
import { Icon } from '../icons';

export function FolderLink({ url, label, small }: { url: string; label: string; small?: boolean }) {
  if (url === '') return null;
  return (
    <a class={small ? 'btn sm' : 'btn'} href={url} target="_blank" rel="noopener noreferrer">
      <Icon name="external" />
      {label}
    </a>
  );
}
