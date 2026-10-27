import { renderToString } from 'react-dom/server';
import LexiGene from './components/lexigene';

export function render() {
  return renderToString(<LexiGene />);
}
