import { createRoot } from 'react-dom/client';
import '../ui/pages.css';
import { Popup } from '../ui/popup/Popup';

createRoot(document.getElementById('root')!).render(<Popup />);
