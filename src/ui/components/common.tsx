// Small shared pieces: status chips (§17), empty/error states, top bar, lock pill.
import type { ComponentChildren } from 'preact';
import { groupChips, type StatusCounts } from '../../domain/inventory-view';
import { statusLabel, type StockStatus } from '../../domain/status';
import { Icon, type IconName } from '../icons';
import { useHelper } from '../helper/session';
import { LockPill } from '../shell/LockPill';
import { goBack } from '../shell/router';

/** Color, icon and word together; never color alone (§17). */
export function StatusChip({ status, prefix = '' }: { status: StockStatus; prefix?: string }) {
  const [cls, icon]: [string, IconName] =
    status.kind === 'short'
      ? ['chip red', 'short']
      : status.kind === 'low'
        ? ['chip yel', 'low']
        : status.kind === 'uncounted'
          ? ['chip unc', 'help']
          : ['chip ok', 'check'];
  return (
    <span class={cls}>
      <Icon name={icon} />
      {prefix}
      {statusLabel(status)}
    </span>
  );
}

/** "n short" / "n low spares" / "All stocked" on group headers (§17). */
export function GroupChips({ counts }: { counts: StatusCounts }) {
  return (
    <>
      {groupChips(counts).map((k) =>
        k === 'short' ? (
          <span class="chip red" key={k}>
            <Icon name="short" />
            {counts.short} short
          </span>
        ) : k === 'low' ? (
          <span class="chip yel" key={k}>
            <Icon name="low" />
            {counts.low} low spares
          </span>
        ) : k === 'uncounted' ? (
          <span class="chip unc" key={k}>
            <Icon name="help" />
            {counts.uncounted} not counted
          </span>
        ) : (
          <span class="chip ok" key={k}>
            <Icon name="check" />
            All stocked
          </span>
        ),
      )}
    </>
  );
}

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
  /** Between the title and the lock button (search, filters, exports, Reorder). */
  children?: ComponentChildren;
  /**
   * After the lock button: only the screen's one main button (Add, Save, Receive). Everything else
   * goes in children, so the lock is always at the right edge or just before that button (v0.16).
   */
  actions?: ComponentChildren;
}) {
  // A helper device has no PIN (§6), so no lock button.
  const helper = useHelper();
  return (
    <header class="top">
      {props.back}
      <div class={props.kicker !== undefined ? 'top-title grow' : 'top-title'}>
        {props.kicker !== undefined && <span class="small muted">{props.kicker}</span>}
        <h1 class={props.kicker !== undefined ? 'h1 clip' : 'h1'}>{props.title}</h1>
        {props.subtitle !== undefined && <span class="small muted">{props.subtitle}</span>}
      </div>
      {props.children}
      {!helper && <LockPill />}
      {props.actions}
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

/** The lock shown on buttons for actions that need the mentor PIN (§17). */
export function PinMark() {
  return <Icon name="lock" class="ic pinmark" label="needs the mentor PIN" />;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The tick box inside a role="checkbox" button (Labels step 1, Inventory Select, F28). */
export function CheckBox({ state }: { state: 'on' | 'some' | 'off' }) {
  return <span class={state === 'off' ? 'cbox' : `cbox ${state}`}>{state === 'on' ? <Icon name="check" /> : state === 'some' ? <Icon name="minus" /> : null}</span>;
}

/** An on/off switch with its label (count-in options, F24; helper settings, §18.1). */
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
