'use client';
import { ReactNode, useEffect, useState } from 'react';
import { DUTY, SHORT } from '@/lib/client';

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string; error: boolean }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const { msg, error } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, error }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), error ? 5000 : 3000);
    };
    window.addEventListener('app-toast', on);
    return () => window.removeEventListener('app-toast', on);
  }, []);
  return <div className="toast-root">{items.map((t) => <div key={t.id} className={'toast' + (t.error ? ' error' : '')}>{t.msg}</div>)}</div>;
}

export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        <div className="stack">{children}</div>
        <div className="actions"><button className="btn" onClick={onClose}>닫기</button>{actions}</div>
      </div>
    </div>
  );
}

export function PageHero({ eyebrow, title, desc, children }: { eyebrow: string; title: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <section className="page-hero">
      <div className="container hero-inner">
        <div className="hero-text">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          {desc && <p>{desc}</p>}
        </div>
        {children && <div className="hero-side">{children}</div>}
      </div>
    </section>
  );
}

export function SectionTitle({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}{sub && <small>{sub}</small>}</h2>
      </div>
      {right && <div className="row">{right}</div>}
    </div>
  );
}

export const Tag = ({ duty }: { duty: string }) => <span className={`tag ${duty}`}>{SHORT[duty] || DUTY[duty]}</span>;

export function StatusBadge({ status }: { status: string | null }) {
  if (status === 'confirmed') return <span className="badge ok">확정</span>;
  if (status === 'draft') return <span className="badge warn">초안</span>;
  return <span className="badge">미편성</span>;
}

const SWAP: Record<string, [string, string]> = { pending: ['대기', 'warn'], accepted: ['수락', 'ok'], rejected: ['거절', 'fail'], cancelled: ['취소', ''] };
export function SwapBadge({ status }: { status: string }) {
  const [t, c] = SWAP[status] || [status, ''];
  return <span className={`badge ${c}`}>{t}</span>;
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
