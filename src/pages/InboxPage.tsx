/* ============================================================================
 * InboxPage.tsx - the transactional mailbox.
 * Every e-mail the platform would send (invoices, OTP codes, security alerts,
 * downgrade notices) is stored here and rendered, so the messaging layer is
 * reviewable without an SMTP server.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import { Award, Download, FileText, Inbox as InboxIcon, MailOpen, ShieldCheck, UserPlus, KeyRound } from 'lucide-react';
import type { MailMessage } from '../types';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle } from '../components/ui';
import { inbox, markRead, SUPPORT_EMAIL, SUPPORT_PHONE } from '../services/mailService';
import { istDateTime } from '../lib/ist';

const KIND_META: Record<MailMessage['kind'], { icon: React.ReactNode; tone: 'rose' | 'slate' | 'sky' | 'violet' | 'emerald' | 'amber'; label: string }> = {
  invoice: { icon: <FileText size={13} />, tone: 'emerald', label: 'Invoice' },
  otp: { icon: <KeyRound size={13} />, tone: 'amber', label: 'Verification' },
  welcome: { icon: <UserPlus size={13} />, tone: 'sky', label: 'Welcome' },
  subscription: { icon: <Award size={13} />, tone: 'violet', label: 'Subscription' },
  download: { icon: <Download size={13} />, tone: 'slate', label: 'Download' },
  security: { icon: <ShieldCheck size={13} />, tone: 'rose', label: 'Security' },
};

export function InboxPage() {
  const { user, version, bump } = useApp();
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [filter, setFilter] = useState<'all' | MailMessage['kind']>('all');

  if (!user) return null;

  const mails = useMemo(() => inbox(user.id), [user.id, version]);
  const visible = mails.filter((m) => filter === 'all' || m.kind === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        subtitle={`Transactional mail sent to ${user.email}. Payment confirmations carry your invoice, receipt, validity period and support details.`}
        icon={<InboxIcon size={20} />}
        action={
          <Button
            variant="outline"
            size="sm"
            icon={<MailOpen size={14} />}
            onClick={() => {
              mails.forEach((m) => markRead(m.id));
              bump();
            }}
          >
            Mark all read
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {(['all', 'invoice', 'otp', 'security', 'subscription', 'welcome'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold capitalize transition ${
              filter === f
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <Card className="!p-2">
          {visible.length === 0 ? (
            <EmptyState icon={<InboxIcon size={22} />} title="No messages" message="Purchase a plan or sign in from a new device and the mail will appear here." />
          ) : (
            <div className="max-h-[36rem] space-y-1 overflow-y-auto">
              {visible.map((mail) => {
                const meta = KIND_META[mail.kind];
                return (
                  <button
                    key={mail.id}
                    onClick={() => {
                      setSelected(mail);
                      markRead(mail.id);
                      bump();
                    }}
                    className={`w-full rounded-xl p-3 text-left transition ${
                      selected?.id === mail.id ? 'bg-rose-50 dark:bg-rose-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={meta.tone}>{meta.icon} {meta.label}</Badge>
                      <span className="font-mono text-[10px] text-slate-400">{istDateTime(mail.createdAt)}</span>
                    </div>
                    <p className={`mt-1.5 line-clamp-1 text-xs ${mail.read ? 'font-medium' : 'font-bold'}`}>{mail.subject}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{mail.preview}</p>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          {selected ? (
            <>
              <SectionTitle
                title={selected.subject}
                subtitle={`To ${selected.to} · ${istDateTime(selected.createdAt)}${selected.meta?.code ? ` · code ${selected.meta.code}` : ''}`}
                icon={KIND_META[selected.kind].icon}
              />
              <pre className="max-h-[38rem] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
{selected.body}
              </pre>
            </>
          ) : (
            <EmptyState
              icon={<MailOpen size={24} />}
              title="Select a message"
              message={`Invoices, OTP codes and security notices are rendered here exactly as they would be delivered. Support: ${SUPPORT_EMAIL} · ${SUPPORT_PHONE}`}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
