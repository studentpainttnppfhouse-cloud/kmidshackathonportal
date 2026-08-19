'use client';

import { useState, useTransition } from 'react';
import { Copy, ExternalLink, Eye, Hammer, Table2 } from 'lucide-react';
import type { Department } from '@/lib/types';
import type { FormField, FormSettings } from '@/lib/forms';
import { FormBuilder } from './builder';
import { PublicForm } from './public-form';
import { ResponsesTable, type ResponseRow } from './responses-table';
import { setFormStatusAction } from './actions';

type Tab = 'build' | 'preview' | 'responses';

export function FormDetail({
  formId,
  title,
  description,
  fields,
  settings,
  status,
  publicSlug,
  responses,
  departments,
  canEdit,
  canPromote,
  origin,
}: {
  formId: string;
  title: string;
  description: string;
  fields: FormField[];
  settings: FormSettings;
  status: 'draft' | 'published' | 'closed';
  publicSlug: string | null;
  responses: ResponseRow[];
  departments: Department[];
  canEdit: boolean;
  canPromote: boolean;
  origin: string;
}) {
  const [tab, setTab] = useState<Tab>(canEdit ? 'build' : 'responses');
  const [currentStatus, setCurrentStatus] = useState(status);
  const [slug, setSlug] = useState(publicSlug);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const shareUrl = slug ? `${origin}/f/${slug}` : null;

  const tabs: { key: Tab; label: string; icon: typeof Eye }[] = [
    ...(canEdit ? [{ key: 'build' as const, label: 'Build', icon: Hammer }] : []),
    { key: 'preview', label: 'Preview', icon: Eye },
    { key: 'responses', label: `Responses (${responses.length})`, icon: Table2 },
  ];

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-[11px] border border-line bg-surface p-1">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                tab === key ? 'bg-pink text-white' : 'text-muted-2 hover:text-ink'
              }`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {canEdit ? (
          <>
            {currentStatus !== 'published' ? (
              <button type="button" disabled={pending} className="btn-primary"
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await setFormStatusAction(formId, 'published');
                    if (res.ok) {
                      setCurrentStatus('published');
                      if (res.data?.slug) setSlug(res.data.slug);
                    } else setError(res.error);
                  });
                }}>
                Publish
              </button>
            ) : (
              <button type="button" disabled={pending} className="btn-secondary"
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await setFormStatusAction(formId, 'closed');
                    if (res.ok) setCurrentStatus('closed');
                    else setError(res.error);
                  });
                }}>
                Close form
              </button>
            )}
          </>
        ) : null}
      </div>

      {shareUrl && currentStatus === 'published' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3">
          <span className="text-[12.5px] font-semibold text-muted-2">Public link</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-deep">{shareUrl}</code>
          <button type="button" className="btn-quiet py-1.5"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}>
            <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
          </button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="btn-quiet py-1.5">
            <ExternalLink size={13} /> Open
          </a>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {tab === 'build' && canEdit ? (
        <FormBuilder
          formId={formId}
          initialTitle={title}
          initialDescription={description}
          initialFields={fields}
          initialSettings={settings}
        />
      ) : null}

      {tab === 'preview' ? (
        <div className="-mx-4 md:-mx-[26px]">
          <PublicForm
            formId={formId}
            title={title}
            description={description}
            fields={fields}
            confirmationMessage={settings.confirmationMessage}
            requiresEmail={!settings.loginRequired}
            preview
          />
        </div>
      ) : null}

      {tab === 'responses' ? (
        <ResponsesTable
          formId={formId}
          fields={fields}
          responses={responses}
          departments={departments}
          canPromote={canPromote}
        />
      ) : null}
    </div>
  );
}
