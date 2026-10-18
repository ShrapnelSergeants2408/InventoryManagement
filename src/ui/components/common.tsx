// Small shared pieces: status chips (§17), empty/error states, top bar, lock pill.
import type { ComponentChildren } from 'preact';
import { groupChips, type StatusCounts } from '../../domain/inventory-view';
import { statusLabel, type StockStatus } from '../../domain/status';
import { Icon, type IconName } from '../icons';
import { goBack } from '../shell/router';

/** Color, icon and word together; never color alone (§17). */
export function StatusChip({ status }: { status: StockStatus }) {
  const [cls, icon]: [string, IconName] =
    status.kind === 'short' ? ['chip red', 'short'] : status.kind === 'low' ? ['chip yel', 'low'] : ['chip ok', 'check'];
  return (
    <span class={cls}>
      <Icon name={icon} />
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

/** Placeholder until the mentor PIN arrives (M6): always "Locked". */
export function LockPill() {
  return (
    <button class="lockpill" type="button" aria-label="Mentor PIN status: locked" title="Mentor PIN arrives in a later milestone" aria-disabled="true">
      <Icon name="lock" />
      Locked
    </button>
  );
}

export function TopBar(props: {
  title: string;
  subtitle?: string;
  /** Small line above the title (breadcrumb on detail and edit screens). */
  kicker?: string;
  /** Back or Cancel button before the title. */
  back?: ComponentChildren;
  /** Between the title and the lock button (search, filters). */
  children?: ComponentChildren;
  /** After the lock button (Add, Save, Reorder). */
  actions?: ComponentChildren;
}) {
  return (
    <header class="top">
      {props.back}
      <div class={props.kicker !== undefined ? 'top-title grow' : 'top-title'}>
        {props.kicker !== undefined && <span class="small muted">{props.kicker}</span>}
        <h1 class={props.kicker !== undefined ? 'h1 clip' : 'h1'}>{props.title}</h1>
        {props.subtitle !== undefined && <span class="small muted">{props.subtitle}</span>}
      </div>
      {props.children}
      <LockPill />
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
