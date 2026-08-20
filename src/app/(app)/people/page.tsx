import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getDepartments, getDirectory } from '@/lib/db/reads';
import { PeopleClient } from '@/features/people/people-client';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const [people, departments] = await Promise.all([
    getDirectory(user),
    getDepartments(user),
  ]);

  return <PeopleClient people={people} departments={departments} />;
}
