import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

/**
 * The outermost net.
 *
 * React unmounts the entire tree when an error escapes a render or an effect,
 * and a trainer that renders nothing is a black screen with no explanation and
 * no way out. Individual screens and the drill itself carry their own
 * boundaries; this one catches everything above them — the boot gate, champion
 * select, the arena behind the menus — so the worst case is a page that says
 * what happened and offers to reload, never a page that says nothing.
 */
createRoot(el).render(
  <StrictMode>
    <ErrorBoundary what="APEX">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
