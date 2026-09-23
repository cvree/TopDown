import type { ReactNode } from 'react';
import { Why } from './Why';

/**
 * A screen's "how this works", closed by default. It is the client's one
 * WHY disclosure under the name the screens already use for it.
 */
export function Explainer({ title, children }: { title: string; children: ReactNode }) {
  return <Why label={title.toLowerCase()}>{children}</Why>;
}
