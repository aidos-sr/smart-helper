import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
async function setup() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid()to anon,authenticated,service_role;insert into auth.users values('${A}'),('${B}');`,
  );
  try {
    for (const file of (
      await readdir(new URL("../supabase/migrations/", import.meta.url))
    ).sort())
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}
async function asUser(db, role, uid, query, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid || "",
    ]);
    return tx.query(query, params);
  });
}
test(
  "real Postgres migrations enforce anonymous and A/B ownership, server-only quota and append-only progress",
  { timeout: 60000 },
  async () => {
    const db = await setup();
    try {
      await assert.rejects(
        asUser(db, "anon", null, "select * from public.chats"),
        /permission denied/,
      );
      const row = await asUser(
        db,
        "authenticated",
        A,
        "insert into public.chats(user_id,title,messages)values($1,'A','[]')returning id",
        [A],
      );
      const id = row.rows[0].id;
      assert.equal(
        (await asUser(db, "authenticated", B, "select * from public.chats"))
          .rows.length,
        0,
      );
      await assert.rejects(
        asUser(
          db,
          "authenticated",
          B,
          "insert into public.chats(user_id,title)values($1,'forged')",
          [A],
        ),
        /row-level security/,
      );
      assert.equal(
        (
          await asUser(
            db,
            "authenticated",
            B,
            "update public.chats set title='B'where id=$1 returning id",
            [id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await asUser(
            db,
            "authenticated",
            B,
            "delete from public.chats where id=$1 returning id",
            [id],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        asUser(
          db,
          "authenticated",
          A,
          "select * from public.consume_ai_quota($1,10,50)",
          [A],
        ),
        /permission denied/,
      );
      assert.equal(
        (
          await asUser(
            db,
            "service_role",
            null,
            "select * from public.consume_ai_quota($1,10,50)",
            [A],
          )
        ).rows[0].allowed,
        true,
      );
      await assert.rejects(
        asUser(
          db,
          "authenticated",
          A,
          "insert into public.progress(user_id,xp)values($1,500)",
          [A],
        ),
        /permission denied/,
      );
      const e = {
        id: "33333333-3333-4333-8333-333333333333",
        date: "2026-11-26",
        xp: 5,
      };
      const merge = (events) =>
        asUser(
          db,
          "authenticated",
          A,
          "select public.merge_progress_events($1::jsonb,'{}'::jsonb) as value",
          [JSON.stringify(events)],
        );
      assert.equal((await merge([e])).rows[0].value.xp, 5);
      assert.equal((await merge([e])).rows[0].value.xp, 5);
      const second = {
        ...e,
        id: "44444444-4444-4444-8444-444444444444",
        xp: 10,
      };
      assert.equal((await merge([second])).rows[0].value.xp, 15);
      assert.equal(
        (await asUser(db, "authenticated", B, "select * from public.progress"))
          .rows.length,
        0,
      );
      await assert.rejects(
        asUser(
          db,
          "authenticated",
          A,
          "select public.reserve_ai_attempt($1,'ai',2000,10)",
          [A],
        ),
        /permission denied/,
      );
    } finally {
      await db.close();
    }
  },
);
test(
  "database leases, idempotency, privacy and budgets survive independent requests",
  { timeout: 60000 },
  async () => {
    const db = await setup();
    try {
      const claim = (uid, id, hash = "hash") =>
        asUser(
          db,
          "service_role",
          null,
          "select public.claim_ai_job($1,$2,$3,'quiz','{}',2) as value",
          [uid, id, hash],
        );
      const id = "55555555-5555-4555-8555-555555555555",
        id2 = "66666666-6666-4666-8666-666666666666";
      assert.deepEqual((await claim(A, id)).rows[0].value.parts, []);
      assert.equal(
        (await claim(A, id2)).rows[0].value.error,
        "CONCURRENCY_LIMIT",
      );
      assert.equal(
        (await claim(B, id)).rows[0].value.error,
        "OPERATION_CONFLICT",
      );
      assert.equal(
        (await asUser(db, "authenticated", B, "select * from public.ai_jobs"))
          .rows.length,
        0,
      );
      await db.query(
        "update public.ai_jobs set status='complete',result='{\"data\":{\"x\":1}}'where id=$1",
        [id],
      );
      assert.deepEqual((await claim(A, id)).rows[0].value.cached, {
        data: { x: 1 },
      });
      assert.deepEqual((await claim(A, id2)).rows[0].value.cached, {
        data: { x: 1 },
      });
      const cost = (amount) =>
        asUser(
          db,
          "service_role",
          null,
          "select public.reserve_ai_cost($1,$2,0.5,5)as value",
          [A, amount],
        );
      assert.equal((await cost(0.3)).rows[0].value, true);
      assert.equal((await cost(0.3)).rows[0].value, false);
      const attempt = () =>
        asUser(
          db,
          "service_role",
          null,
          "select public.reserve_ai_attempt($1,'search',2000,1)as value",
          [A],
        );
      assert.equal((await attempt()).rows[0].value.allowed, true);
      assert.equal((await attempt()).rows[0].value.allowed, false);
    } finally {
      await db.close();
    }
  },
);

test('database storage cap also applies to direct inserts while allowing an upsert at the cap',{timeout:60000},async()=>{
 const db=await setup();try{
  await asUser(db,'authenticated',A,"insert into public.chats(user_id,title)select $1,'Chat '||n from generate_series(1,500)n",[A]);
  await assert.rejects(asUser(db,'authenticated',A,"insert into public.chats(user_id,title)values($1,'Too many')",[A]),/USER_STORAGE_QUOTA/);
  const id=(await asUser(db,'authenticated',A,'select id from public.chats limit 1')).rows[0].id;
  await asUser(db,'authenticated',A,"insert into public.chats(id,user_id,title)values($1,$2,'Renamed')on conflict(id)do update set title=excluded.title",[id,A]);
  await asUser(db,'authenticated',B,"insert into public.study_materials(user_id,kind,title,content,folder,tags)values($1,'quiz','Own','{}','Grade 9',array['logic'])",[B]);
  assert.equal((await asUser(db,'authenticated',A,'select * from public.study_materials')).rows.length,0);
 }finally{await db.close();}
});
