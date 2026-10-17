import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import { render } from 'preact';
import { DevStatus } from './ui/DevStatus';

render(<DevStatus />, document.getElementById('app')!);
