import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/labels.css';
import './styles/scan.css';
import './styles/count.css';
import { render } from 'preact';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
