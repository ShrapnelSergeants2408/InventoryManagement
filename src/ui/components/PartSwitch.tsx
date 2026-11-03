// The part switch (SPEC v3.0 F21): Household | Holiday at the top of the main screens, the
// current part in its color. Tapped, never swiped (§11). Switching opens the other part's home
// (or, from Find, its Find with the same search) and keeps nothing open from this part.
import { PARTS, PART_NAME, type Part } from '../../domain/types';
import { href, type Tab } from '../shell/router';

export function PartSwitch({ part, tab, q = '' }: { part: Part; tab?: Tab; q?: string }) {
  return (
    <nav class="psw" aria-label="Part">
      {PARTS.map((p) => (
        <a key={p} href={p === part ? undefined : tab === 'find' ? href.tab(p, 'find', q) : href.home(p)} class={`psw-${p}`} aria-current={p === part ? 'page' : undefined}>
          {PART_NAME[p]}
        </a>
      ))}
    </nav>
  );
}
