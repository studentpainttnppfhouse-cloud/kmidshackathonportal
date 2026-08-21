import { describe, expect, it } from 'vitest';
import { QueryBuilder } from '@/lib/pg/builder';
import { parseSelect } from '@/lib/pg/select';
import { resolveRelationship } from '@/lib/pg/relationships';

/** Captures the SQL a builder would run instead of touching a database. */
function capture() {
  const seen: { text: string; values: unknown[] }[] = [];
  const exec = async (text: string, values: unknown[]) => {
    seen.push({ text, values });
    return [];
  };
  return { seen, exec };
}

describe('select parsing', () => {
  it('reads plain columns', () => {
    expect(parseSelect('id, title, status')).toEqual({
      columns: ['id', 'title', 'status'],
      embeds: [],
    });
  });

  it('reads an aliased embed', () => {
    const node = parseSelect('id, owner:owner_id ( nickname, name )');
    expect(node.columns).toEqual(['id']);
    expect(node.embeds).toHaveLength(1);
    expect(node.embeds[0]!.alias).toBe('owner');
    expect(node.embeds[0]!.hint).toBe('owner_id');
    expect(node.embeds[0]!.node.columns).toEqual(['nickname', 'name']);
  });

  it('reads a nested embed', () => {
    const node = parseSelect('id, assignment_assignees ( user_id, users ( nickname, name ) )');
    const outer = node.embeds[0]!;
    expect(outer.hint).toBe('assignment_assignees');
    expect(outer.node.embeds[0]!.hint).toBe('users');
    expect(outer.node.embeds[0]!.node.columns).toEqual(['nickname', 'name']);
  });

  it('recognises the count aggregate', () => {
    const node = parseSelect('id, form_responses(count)');
    expect(node.embeds[0]!.isCount).toBe(true);
  });

  it('rejects a malformed select rather than dropping columns', () => {
    expect(() => parseSelect('id, owner:owner_id ( name')).toThrow(/Unclosed/);
    expect(() => parseSelect('')).toThrow(/nothing selected/i);
  });
});

describe('relationship resolution', () => {
  it('resolves a foreign key column to a to-one embed', () => {
    expect(resolveRelationship('documents', 'owner_id')).toEqual({
      kind: 'one',
      table: 'users',
      localColumn: 'owner_id',
      foreignColumn: 'id',
    });
  });

  it('resolves a child table to a to-many embed', () => {
    expect(resolveRelationship('forms', 'form_responses')).toEqual({
      kind: 'many',
      table: 'form_responses',
      localColumn: 'id',
      foreignColumn: 'form_id',
    });
  });

  it('resolves an unambiguous table name to a to-one embed', () => {
    expect(resolveRelationship('assignment_assignees', 'users')).toEqual({
      kind: 'one',
      table: 'users',
      localColumn: 'user_id',
      foreignColumn: 'id',
    });
  });

  it('refuses to guess when two foreign keys point at the same table', () => {
    // documents.owner_id and documents.approved_by both reference users.
    expect(() => resolveRelationship('documents', 'users')).toThrow(/Ambiguous/);
  });
});

describe('generated SQL', () => {
  it('filters, orders and limits a plain select', async () => {
    const { seen, exec } = capture();
    await new QueryBuilder('assignments', exec)
      .select('id, title')
      .is('deleted_at', null)
      .eq('department_id', 'dept-1')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50);

    expect(seen[0]!.text).toBe(
      'select "assignments"."id", "assignments"."title" from "assignments" ' +
        'where "deleted_at" is null and "department_id" = $1 ' +
        'order by "due_date" asc nulls last limit 50',
    );
    expect(seen[0]!.values).toEqual(['dept-1']);
  });

  it('embeds a to-one relation as an object', async () => {
    const { seen, exec } = capture();
    await new QueryBuilder('documents', exec).select('id, owner:owner_id ( nickname )');

    expect(seen[0]!.text).toContain('to_jsonb(e.*)');
    expect(seen[0]!.text).toContain('"t1"."id" = "documents"."owner_id"');
    expect(seen[0]!.text).toContain('as "owner"');
  });

  it('embeds a to-many relation as an array, empty rather than null', async () => {
    const { seen, exec } = capture();
    await new QueryBuilder('assignments', exec).select('id, assignment_assignees ( user_id )');

    expect(seen[0]!.text).toContain('jsonb_agg');
    expect(seen[0]!.text).toContain("'[]'::jsonb");
    expect(seen[0]!.text).toContain('"t1"."assignment_id" = "assignments"."id"');
  });

  it('renders a count embed in the shape the screens read', async () => {
    const { seen, exec } = capture();
    await new QueryBuilder('forms', exec).select('id, form_responses(count)');

    expect(seen[0]!.text).toContain("jsonb_build_array(jsonb_build_object('count', count(*)))");
  });

  it('numbers update placeholders across SET and WHERE', async () => {
    const { seen, exec } = capture();
    await new QueryBuilder('users', exec)
      .update({ nickname: 'Ada', tier: 'T2' })
      .eq('id', 'user-1')
      .select('id');

    expect(seen[0]!.text).toBe(
      'update "users" set "nickname" = $1, "tier" = $2 where "id" = $3 returning "users"."id"',
    );
    expect(seen[0]!.values).toEqual(['Ada', 'T2', 'user-1']);
  });

  it('builds an upsert that updates only the non-conflict columns', async () => {
    const { seen, exec } = capture();
    await new QueryBuilder('checkins', exec).upsert(
      { user_id: 'u1', day: '2027-03-20', arrived_at: 'now' },
      { onConflict: 'user_id,day' },
    );

    expect(seen[0]!.text).toContain('on conflict ("user_id", "day") do update set "arrived_at" = excluded."arrived_at"');
  });

  it('refuses a multi-row insert whose rows set different columns', async () => {
    const { exec } = capture();
    const res = await new QueryBuilder('invited_users', exec).insert([
      { email: 'a@x.com', tier: 'T1' },
      { email: 'b@x.com' },
    ]);
    expect(res.error?.message).toMatch(/same columns/);
  });

  it('returns no data for a mutation without select, like return=minimal', async () => {
    const { exec } = capture();
    const res = await new QueryBuilder('users', exec).update({ nickname: 'Ada' }).eq('id', 'u1');
    expect(res).toEqual({ data: null, error: null, count: null });
  });
});

describe('row modes', () => {
  const oneRow = async () => [{ id: 'a' }];
  const noRows = async () => [];
  const twoRows = async () => [{ id: 'a' }, { id: 'b' }];

  it('maybeSingle returns null for no rows without an error', async () => {
    const res = await new QueryBuilder('users', noRows).select('id').maybeSingle();
    expect(res).toEqual({ data: null, error: null, count: null });
  });

  it('single errors when nothing matched', async () => {
    const res = await new QueryBuilder('users', noRows).select('id').single();
    expect(res.error?.code).toBe('PGRST116');
  });

  it('errors when more than one row comes back', async () => {
    const res = await new QueryBuilder('users', twoRows).select('id').maybeSingle();
    expect(res.error?.message).toMatch(/got 2/);
  });

  it('unwraps the single row', async () => {
    const res = await new QueryBuilder('users', oneRow).select('id').maybeSingle();
    expect(res.data).toEqual({ id: 'a' });
  });

  it('surfaces a database error as error, not a throw', async () => {
    const failing = async () => {
      throw Object.assign(new Error('new row violates row-level security policy'), {
        code: '42501',
      });
    };
    const res = await new QueryBuilder('files', failing).insert({ name: 'x' });
    expect(res.data).toBeNull();
    expect(res.error?.message).toContain('row-level security');
    expect(res.error?.code).toBe('42501');
  });
});
