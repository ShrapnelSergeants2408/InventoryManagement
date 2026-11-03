// Small shared pieces: empty/error states, top bar, back button, check box, toggle.
import type { ComponentChildren } from 'preact';
import { PART_NAME, type Part } from '../../domain/types';
import { Icon, type IconName } from '../icons';
import { goBack } from '../shell/router';

export function StateMessage(props: {
  icon: IconName;
  tone?: 'neutral' | 'alert';
  title: string;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  role?: 'alert' | 'status';
}) {
  return (
    <div class="state" role={props.role}>
      <div class={props.tone === 'alert' ? 'bigic alert' : 'bigic'}>
        <Icon name={props.icon} />
      </div>
      <h2 class="h2">{props.title}</h2>
      {props.children}
      {props.actions && <div class="state-actions">{props.actions}</div>}
    </div>
  );
}

export function TopBar(props: {
  title: string;
  subtitle?: string;
  /** Small line above the title (breadcrumb on detail and edit screens). */
  kicker?: string;
  /** Back or Cancel button before the title. */
  back?: ComponentChildren;
  /** The screen's search box (Inventory). */
  search?: ComponentChildren;
  /** After the title (filters, Reorder). */
  children?: ComponentChildren;
  /** At the right end: only the screen's one main button (Add, Save). */
  actions?: ComponentChildren;
  /** A detail screen's record part: the bar takes the part's color and names it (F21). */
  part?: Part;
}) {
  return (
    <header class={props.part ? 'top tint' : 'top'}>
      {props.back}
      <div class={props.kicker !== undefined ? 'top-title grow' : 'top-title'}>
        {props.kicker !== undefined && <span class="small muted">{props.kicker}</span>}
        <h1 class={props.kicker !== undefined ? 'h1 clip' : 'h1'}>{props.title}</h1>
        {props.subtitle !== undefined && <span class="small muted">{props.subtitle}</span>}
      </div>
      {props.children}
      {props.search !== undefined && <div class="top-sl">{props.search}</div>}
      {props.actions}
      {props.part && <span class="ptag">{PART_NAME[props.part]}</span>}
    </header>
  );
}

export function BackButton(props: { label?: string; fallback: string }) {
  return (
    <button type="button" class="btn" onClick={() => goBack(props.fallback)}>
      <Icon name="chevLeft" />
      {props.label ?? 'Back'}
    </button>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The tick box inside a role="checkbox" button (Labels step 1, Inventory Select). */
export function CheckBox({ state }: { state: 'on' | 'some' | 'off' }) {
  return <span class={state === 'off' ? 'cbox' : `cbox ${state}`}>{state === 'on' ? <Icon name="check" /> : state === 'some' ? <Icon name="minus" /> : null}</span>;
}

/** An on/off switch with its label. */
export function Toggle(props: { on: boolean; onClick: () => void; disabled?: boolean; children: ComponentChildren }) {
  return (
    <button type="button" class="tog" role="switch" aria-checked={props.on} disabled={props.disabled} onClick={props.onClick}>
      <span class={props.on ? 'sw on' : 'sw'} aria-hidden="true">
        <span />
      </span>
      <span>{props.children}</span>
    </button>
  );
}
