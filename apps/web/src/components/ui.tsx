'use client';

import { type ReactNode, type InputHTMLAttributes } from 'react';

/** A titled panel grouping one role's command cards. */
export function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      {desc && <p className="text-sm text-gray-500 mt-0.5 mb-3">{desc}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** One command card: a heading, optional blurb, the form fields, and the action button(s). */
export function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="p-4 rounded-xl border border-gray-200 bg-white">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <input
        {...props}
        className="mt-0.5 w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300 focus:border-gray-500 focus:outline-none font-mono"
      />
    </label>
  );
}

/** A read-only key/value panel for on-chain state. */
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="text-sm divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 px-3 py-1.5">
          <dt className="text-gray-500">{k}</dt>
          <dd className="font-mono text-gray-800 text-right break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
