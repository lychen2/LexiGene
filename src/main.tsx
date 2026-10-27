import { createRoot, hydrateRoot } from 'react-dom/client';
import LexiGene from './components/lexigene';
import './app/globals.css';

const root = document.getElementById('root')!;
if (root.hasChildNodes() && root.firstElementChild) {
  hydrateRoot(root, <LexiGene />);
} else {
  createRoot(root).render(<LexiGene />);
}
