// Screens that later milestones fill in (stage4-plan §4).
import { StateMessage, TopBar } from '../components/common';
import { Icon } from '../icons';
import { href } from '../shell/router';

export function Placeholder(props: { title: string; milestone: string; what: string; back?: boolean }) {
  return (
    <>
      <TopBar title={props.title} />
      <StateMessage
        icon="tools"
        title={`${props.title} isn’t built yet`}
        actions={
          props.back && (
            <a class="btn" href={href.tab('inventory')}>
              <Icon name="chevLeft" />
              Back to Inventory
            </a>
          )
        }
      >
        <p class="state-text">
          {props.what} It arrives in {props.milestone}.
        </p>
      </StateMessage>
    </>
  );
}
