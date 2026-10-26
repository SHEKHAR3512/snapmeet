import { createRoot } from 'react-dom/client';
import '../ui/pages.css';
import '../ui/dock/dock.css';
import '../../playground/playground.css';
import { Playground } from '../../playground/Playground';

createRoot(document.getElementById('root')!).render(<Playground />);
