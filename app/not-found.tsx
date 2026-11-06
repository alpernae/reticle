'use client';
// 404 — PanelUI NotFound: a pixel "404" whose digits scatter under the pointer.
import Link from 'next/link';
import { NotFound } from '@/components/panelui/not-found';
import { btn, btnPrimary } from '@/components/panel';

export default function NotFoundPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <NotFound>
        <NotFound.Code code="404" effect="scatter" />
        <NotFound.Title>Nothing on the radar here</NotFound.Title>
        <NotFound.Description>The address may be mistyped, or the page has moved. Your posts, runs and drafts are untouched.</NotFound.Description>
        <NotFound.Actions>
          <Link href="/" className={btnPrimary}>Back to Overview</Link>
          <Link href="/activity" className={btn}>Open Activity</Link>
        </NotFound.Actions>
      </NotFound>
    </div>
  );
}
