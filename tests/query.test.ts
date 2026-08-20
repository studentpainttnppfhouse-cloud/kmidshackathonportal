import { describe, expect, it } from 'vitest';
import { compile, parseSelect, QueryError, type QuerySpec } from '@/lib/db/query';

/**
 * The SQL compiler is what replaced PostgREST, so it carries the whole data
 * layer on its back. These tests pin the exact statement for every shape the
 * app actually uses — a change that quietly drops a filter or an embed would
 * otherwise show up as an empty page rather than as a failure.
 */

const base = (patch: Partial<QuerySpec> = {}): QuerySpec => ({
  table: 'users',
  kind: 'select',
  filters: [],
  orders: [],
  ...patch,
});

describe('parseSelect', () => {
  it('reads a plain column list', () => {
    expect(parseSelect('id, name, email')).toEqual([
      { kind: 'column', name: 'id', alias: null },
      { kind: 'column', name: 'name', alias: null },
      { kind: 'column', name: 'email', alias: null },
    ]);
  });

  it('reads an embed reached through a named column', () => {
    const [field] = parseSelect('users:author_id ( nickname, name )');
    expect(field).toMatchObject({ kind: 'embed', alias: 'users', hint: 'author_id' });
  });

  it('reads a nested embed', () => {
    const [field] = parseSelect('assignment_assignees ( user_id, users ( nickname ) )');
    expect(field).toMatchObject({ kind: 'embed', hint: 'assignment_assignees' });
    expect((field as { children: unknown[] }).children).toHaveLength(2);
  });

  it('recognises a count embed', () => {
    const [field] = parseSelect('form_responses(count)');
    expect(field).toMatchObject({ kind: 'embed', hint: 'form_responses', countOnly: true });
  });

  it('refuses an unbalanced select list', () => {
    expect(() => parseSelect('users ( name')).toThrow(QueryError);
  });
});

describe('select', () => {
  it('qualifies columns and binds the limit', () => {
    const { text, values } = compile(
      base({ columns: 'id, email', limit: 30 }),
    );
    expect(text).toBe('select t0."id", t0."email" from public."users" t0 limit $1');
    expect(values).toEqual([30]);
  });

  it('binds every filter value rather than interpolating it', () => {
    const { text, values } = compile(
      base({
        columns: 'id',
        filters: [
          { column: 'email', op: 'eq', value: "bobby'; drop table users; --" },
          { column: 'deleted_at', op: 'is', value: null },
        ],
      }),
    );
    expect(text).toContain('where t0."email" = $1 and t0."deleted_at" is null');
    expect(values).toEqual(["bobby'; drop table users; --"]);
  });

  it('spells out null ordering so a flipped sort does not reshuffle', () => {
    const { text } = compile(
      base({
        columns: 'id',
        orders: [{ column: 'due_date', ascending: true, nullsFirst: false }],
      }),
    );
    expect(text).toContain('order by t0."due_date" asc nulls last');
  });

  it('passes an in() list as a single array parameter', () => {
    const { text, values } = compile(
      base({
        table: 'comments',
        columns: 'id',
        filters: [{ column: 'parent_id', op: 'in', value: ['a', 'b'] }],
      }),
    );
    expect(text).toContain('t0."parent_id" = any($1)');
    expect(values).toEqual([['a', 'b']]);
  });

  it('counts without fetching rows when asked for a head count', () => {
    const { text } = compile(
      base({ columns: 'id', count: true, head: true, filters: [] }),
    );
    expect(text).toBe('select count(*)::bigint as "count" from public."users" t0');
  });

  it('takes a full count before the limit, not after', () => {
    const { text } = compile(base({ columns: 'id', count: true, limit: 10 }));
    expect(text).toContain('count(*) over () as "__count"');
  });

  it('refuses eq(column, null), which silently matches nothing in SQL', () => {
    expect(() =>
      compile(base({ columns: 'id', filters: [{ column: 'x', op: 'eq', value: null }] })),
    ).toThrow(/never matches/);
  });

  it('refuses an identifier that is not one', () => {
    expect(() => compile(base({ table: 'users; drop table users' }))).toThrow(QueryError);
    expect(() => compile(base({ columns: 'id"; --' }))).toThrow(QueryError);
  });
});

describe('embedded rows', () => {
  it('renders a parent row as a JSON object, null when absent', () => {
    const { text } = compile(
      base({
        table: 'announcements',
        columns: 'id, users:author_id ( nickname, name )',
      }),
    );
    expect(text).toContain(
      'select to_jsonb(e) from (select t1."nickname", t1."name" from public."users" t1 ' +
        'where t1."id" = t0."author_id") e) as "users"',
    );
  });

  it('resolves a bare table name through its only foreign key', () => {
    const { text } = compile(
      base({ table: 'spreadsheets', columns: 'id, departments ( name )' }),
    );
    expect(text).toContain('where t1."id" = t0."department_id") e) as "departments"');
  });

  it('renders child rows as an array, empty rather than null', () => {
    const { text } = compile(
      base({
        table: 'assignments',
        columns: 'id, assignment_assignees ( user_id, users ( nickname ) )',
      }),
    );
    expect(text).toContain('jsonb_agg(e)');
    expect(text).toContain("'[]'::jsonb");
    // The nested embed hangs off the child, not off the parent.
    expect(text).toContain('where t2."id" = t1."user_id"');
    expect(text).toContain('where t1."assignment_id" = t0."id"');
  });

  it('renders a count embed the way the pages read it', () => {
    const { text } = compile(base({ table: 'forms', columns: 'id, form_responses(count)' }));
    expect(text).toContain("jsonb_build_array(jsonb_build_object('count', count(*)))");
    expect(text).toContain('where t1."form_id" = t0."id"');
  });

  it('refuses an ambiguous embed rather than guessing which key to use', () => {
    // `documents` reaches `users` through both owner_id and approved_by.
    expect(() => compile(base({ table: 'documents', columns: 'id, users ( name )' })))
      .toThrow(/ambiguous/);
  });

  it('refuses an embed with no relationship behind it', () => {
    // `quick_reference` stands on its own — no key points at it or away from it.
    expect(() => compile(base({ table: 'users', columns: 'id, quick_reference ( id )' })))
      .toThrow(/No relationship/);
  });
});

describe('writes', () => {
  it('inserts and returns the requested columns', () => {
    const { text, values } = compile(
      base({ kind: 'insert', values: { email: 'a@b.c', tier: 'T1' }, columns: 'id, email' }),
    );
    expect(text).toBe(
      'insert into public."users" as t0 ("email", "tier") values ($1, $2) ' +
        'returning t0."id", t0."email"',
    );
    expect(values).toEqual(['a@b.c', 'T1']);
  });

  it('writes every column any row in a batch mentions', () => {
    const { text, values } = compile(
      base({
        table: 'assignment_assignees',
        kind: 'insert',
        values: [{ assignment_id: '1', user_id: 'a' }, { assignment_id: '1', user_id: 'b' }],
      }),
    );
    expect(text).toContain('values ($1, $2), ($3, $4)');
    expect(values).toEqual(['1', 'a', '1', 'b']);
  });

  it('refreshes the non-key columns on an upsert', () => {
    const { text } = compile(
      base({
        table: 'checkins',
        kind: 'upsert',
        values: { user_id: 'u', day: '2027-03-20', checked_in_at: 'now' },
        onConflict: 'user_id,day',
      }),
    );
    expect(text).toContain('on conflict ("user_id", "day") do update set ' +
      '"checked_in_at" = excluded."checked_in_at"');
  });

  it('does nothing on conflict when there is nothing left to update', () => {
    const { text } = compile(
      base({
        table: 'announcement_reads',
        kind: 'upsert',
        values: { announcement_id: 'a', user_id: 'u' },
        onConflict: 'announcement_id,user_id',
      }),
    );
    expect(text).toContain('do nothing');
  });

  it('applies filters to an update', () => {
    const { text, values } = compile(
      base({
        kind: 'update',
        values: { status: 'active' },
        filters: [{ column: 'id', op: 'eq', value: 'u1' }],
        columns: 'id',
      }),
    );
    expect(text).toBe(
      'update public."users" t0 set "status" = $1 where t0."id" = $2 returning t0."id"',
    );
    expect(values).toEqual(['active', 'u1']);
  });

  it('deletes with its filters', () => {
    const { text } = compile(
      base({
        table: 'file_blobs',
        kind: 'delete',
        filters: [{ column: 'file_id', op: 'eq', value: 'f1' }],
      }),
    );
    expect(text).toBe('delete from public."file_blobs" t0 where t0."file_id" = $1');
  });

  it('refuses a write with no columns', () => {
    expect(() => compile(base({ kind: 'update', values: {} }))).toThrow(QueryError);
    expect(() => compile(base({ kind: 'insert', values: [] }))).toThrow(QueryError);
  });
});
