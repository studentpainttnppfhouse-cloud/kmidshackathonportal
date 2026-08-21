import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/pg/server';
import { getSessionUser } from '@/lib/auth/session';
import type { FormField, FormSettings } from '@/lib/forms';
import { PublicForm } from '@/features/forms/public-form';

export const dynamic = 'force-dynamic';

/**
 * The public submission page. Lives outside the (app) group so it renders
 * without the staff shell and without requiring a session.
 */
export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data } = await adminClient()
    .from('forms')
    .select('id, title, description, schema, settings, status, opens_at, closes_at')
    .eq('public_slug', slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();

  const form = data as unknown as {
    id: string;
    title: string;
    description: string | null;
    schema: { fields: FormField[] } | null;
    settings: FormSettings | null;
    status: string;
    opens_at: string | null;
    closes_at: string | null;
  };

  const now = new Date();
  const notYetOpen = form.opens_at !== null && new Date(form.opens_at) > now;
  const alreadyClosed = form.closes_at !== null && new Date(form.closes_at) < now;

  if (form.status !== 'published' || notYetOpen || alreadyClosed) {
    return (
      <ClosedNotice
        title={form.title}
        reason={
          notYetOpen
            ? 'This form has not opened yet.'
            : alreadyClosed
              ? 'This form has closed.'
              : 'This form is not accepting responses.'
        }
      />
    );
  }

  const user = await getSessionUser();
  if (form.settings?.loginRequired && !user) {
    return (
      <ClosedNotice
        title={form.title}
        reason="You need to sign in with your school account to fill this in."
        signInHref={`/signin?next=/f/${slug}`}
      />
    );
  }

  return (
    <PublicForm
      formId={form.id}
      title={form.title}
      description={form.description}
      fields={form.schema?.fields ?? []}
      confirmationMessage={form.settings?.confirmationMessage}
      requiresEmail={!form.settings?.loginRequired}
    />
  );
}

function ClosedNotice({
  title,
  reason,
  signInHref,
}: {
  title: string;
  reason: string;
  signInHref?: string;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-5">
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-surface p-8 text-center shadow-raised">
        <h1 className="text-[19px] font-extrabold tracking-[-0.01em]">{title}</h1>
        <p className="mt-2 text-[13.5px] text-muted-2">{reason}</p>
        {signInHref ? (
          <a href={signInHref} className="btn-primary mt-5 w-full">Sign in</a>
        ) : null}
      </div>
    </div>
  );
}
