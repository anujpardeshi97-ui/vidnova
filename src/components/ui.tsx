/* ============================================================================
 * ui.tsx - shared presentation primitives.
 * Small, dependency-light building blocks so pages stay readable and the
 * product looks consistent (rounded-2xl cards, soft borders, accent accents).
 * ==========================================================================*/
import React from 'react';
import {
  AlertTriangle, Check, CheckCircle2, Info, Loader2, X, XCircle,
} from 'lucide-react';
import type { Toast } from '../types';

/* --------------------------------- Layout --------------------------------- */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/70 ${padded ? 'p-5' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  right,
  icon,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-rose-500">{icon}</div>}
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-700 text-white shadow-lg shadow-rose-600/20">
            {icon}
          </span>
        )}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* -------------------------------- Controls -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-rose-600 text-white hover:bg-rose-500 shadow-sm shadow-rose-600/20',
  secondary: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
  outline:
    'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'slate',
  className = '',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'rose' | 'amber' | 'emerald' | 'sky' | 'violet' | 'red';
  className?: string;
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Progress({
  value,
  barClass = 'bg-rose-500',
  trackClass = 'bg-slate-200 dark:bg-slate-700',
  className = '',
}: {
  value: number;
  /** Full Tailwind class, passed explicitly so the JIT compiler can see it. */
  barClass?: string;
  trackClass?: string;
  className?: string;
}) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full ${trackClass} ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${barClass}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white';

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      <span>
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
        {hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-rose-600' : 'bg-slate-300 dark:bg-slate-600'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[1.15rem]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}

/* --------------------------------- Modal ---------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-700">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="border-t border-slate-200 p-4 dark:border-slate-700">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------- Toasts --------------------------------- */

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const icons = {
    success: <CheckCircle2 size={18} className="text-emerald-500" />,
    error: <XCircle size={18} className="text-red-500" />,
    info: <Info size={18} className="text-sky-500" />,
    warning: <AlertTriangle size={18} className="text-amber-500" />,
  };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
        >
          <div className="mt-0.5">{icons[t.kind]}</div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{t.title}</p>
            {t.message && <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t.message}</p>}
          </div>
          <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- Tabs ----------------------------------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; icon?: React.ReactNode; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px dark:border-slate-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex shrink-0 items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition ${
            active === tab.id
              ? 'border-b-2 border-rose-500 text-rose-600 dark:text-rose-400'
              : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {tab.icon}
          {tab.label}
          {typeof tab.badge === 'number' && tab.badge > 0 && (
            <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon,
  action,
}: {
  title: string;
  message: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KV({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean; key?: React.Key }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-right text-xs font-semibold text-slate-800 dark:text-slate-100 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export function CheckList({ items, miss = false }: { items: string[]; miss?: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          {miss ? (
            <X size={16} className="mt-0.5 shrink-0 text-slate-400" />
          ) : (
            <Check size={16} className="mt-0.5 shrink-0 text-emerald-500" />
          )}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
