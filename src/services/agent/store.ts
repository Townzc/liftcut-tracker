import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { P1_VERSION, createRunSchema, proposalRequestSchema, userEventSchema, executeSchema, contextSchema, planSchema, nutritionPlanSchema, isNutritionPlan,
  validatePlanConstraints, type Binding, type Context, type Outcome, type AnyPlan, type PlanKind, type Receipt, type RunView } from "@liftcut/core/agent-contracts";
import { readPlanRows, type PlanSnapshot } from "./plan-state";
import { persistNutritionPlan } from "./persist-nutrition";
import { beginOwnerTransaction } from "@/services/owner-transaction";
import {readPlanningMemory} from "@/services/ai/fitness-facts";
import {planningMemoryContent,type PlanningMemory} from "@/lib/agent/plan-personalization";
import {localDateAt} from "@liftcut/core/today";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const contentHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
type Row = { id: string; user_id: string; status: RunView["status"]; revision: number; context_revision: number;
  context: Context; profile_hash: string; current_proposal: string | null; approval_id: string | null; attempts: number;
  kind: PlanKind; base_state_hash: string | null; baseline: Record<string, unknown>[] };
const fail = (error: string, retryable = false): Outcome<never> => ({ ok: false, error, retryable });

export class AgentStore {
  constructor(private readonly pool: Pool) {}

  // A verified identity from the auth server is mandatory; never a request body user_id.
  private async tx<T>(userId: string, work: (db: PoolClient) => Promise<T>): Promise<T> {
    z.uuid().parse(userId);
    const db = await this.pool.connect();
    let broken = false;
    try {
      await beginOwnerTransaction(db,userId,"liftcut_agent");
      // Serialize all P1 runs for one user, including receipt keys across runs.
      await db.query("select pg_advisory_xact_lock(hashtextextended($1, 713))", [userId]);
      const result = await work(db);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback").catch(() => { broken = true; });
      throw error; // A COMMIT transport failure remains unknown; no automatic replay.
    } finally { db.release(broken); }
  }

  private async run(db: PoolClient, userId: string, id: string) {
    z.uuid().parse(id);
    return (await db.query<Row>("select * from agent_private.runs where id=$1 and user_id=$2 for update", [id, userId])).rows[0];
  }
  private async event(db: PoolClient, run: Row, type: string, actor: string, data: unknown = {}) {
    await db.query("insert into agent_private.events(user_id,run_id,type,actor,data) values($1,$2,$3,$4,$5)",
      [run.user_id, run.id, type, actor, JSON.stringify(data)]);
  }
  private async profile(db: PoolClient, userId: string): Promise<string | null> {
    // Lock real settings through the write transaction. Any old settings update must wait.
    const row = (await db.query("select to_jsonb(s) as profile from public.user_settings s where user_id=$1 for share", [userId])).rows[0];
    return row ? contentHash(row.profile) : null;
  }
  private async fresh(db: PoolClient, run: Row, memoryCache=new Map<string,PlanningMemory>()): Promise<boolean> {
    const profileFresh = await this.profile(db, run.user_id) === run.profile_hash;
    const planFresh = !run.base_state_hash || contentHash(await readPlanRows(db, run.user_id, run.kind)) === run.base_state_hash;
    const basis=(await db.query("select data from agent_private.events where run_id=$1 and type='planning_basis' order by sequence desc limit 1",[run.id])).rows[0]?.data as {memory:PlanningMemory;memoryHash:string}|undefined;
    let memoryFresh=true;
    if(basis){
      const day=localDateAt(new Date(),basis.memory.timezone),key=`${run.kind}:${basis.memory.timezone}:${day}`;
      // Only shared inside this locked owner transaction, never across requests.
      const current=memoryCache.get(key)??await readPlanningMemory(db,run.user_id,run.kind,day,basis.memory.timezone);
      memoryCache.set(key,current);memoryFresh=contentHash(planningMemoryContent(current))===basis.memoryHash;
    }
    if (profileFresh && planFresh && memoryFresh) return true;
    await db.query("update agent_private.runs set status='stale',approval_id=null,revision=revision+1 where id=$1", [run.id]);
    await this.event(db, run, !profileFresh ? "profile_changed" : !planFresh ? "plan_changed" : "memory_changed", "system");
    return false;
  }
  private async proposal(db: PoolClient, run: Row) {
    return (await db.query("select * from agent_private.proposals where id=$1 and run_id=$2 and user_id=$3",
      [run.current_proposal, run.id, run.user_id])).rows[0] as { id: string; version: number; content_hash: string; context_revision: number; plan: AnyPlan } | undefined;
  }
  private async bound(db: PoolClient, run: Row, binding: Binding) {
    const p = await this.proposal(db, run);
    return p && p.id === binding.proposalId && p.content_hash === binding.contentHash &&
      p.context_revision === binding.contextRevision && run.context_revision === binding.contextRevision ? p : null;
  }
  private async view(db: PoolClient, run: Row): Promise<RunView> {
    const current = (await db.query<Row>("select * from agent_private.runs where id=$1", [run.id])).rows[0];
    const p = await this.proposal(db, current);
    const receipt = (await db.query("select receipt from agent_private.receipts where run_id=$1", [run.id])).rows[0]?.receipt ?? null;
    const events = (await db.query('select sequence::text, type, actor, data, created_at as at from agent_private.events where run_id=$1 order by sequence', [run.id])).rows;
    return { id: run.id, version: P1_VERSION, status: current.status, revision: current.revision,
      kind: current.kind ?? "training", baseline: current.baseline ?? [],
      contextRevision: current.context_revision, context: current.context, attempts: current.attempts,
      approvalId: current.approval_id, proposal: p ? { proposalId: p.id, contentHash: p.content_hash,
        contextRevision: p.context_revision, version: p.version, plan: p.plan } : null, receipt, events };
  }
  async create(userId: string, input: unknown): Promise<Outcome<RunView>> {
    const req = createRunSchema.parse(input);
    return this.tx(userId, async db => {
      const old = (await db.query<Row & { request_hash: string }>("select * from agent_private.runs where user_id=$1 and request_key=$2", [userId, req.requestKey])).rows[0];
      if (old) return old.request_hash === contentHash(req.context) ? { ok: true, value: await this.view(db, old) } : fail("KEY_CONFLICT");
      const profileHash = await this.profile(db, userId);
      if (!profileHash) return fail("PROFILE_REQUIRED");
      const run = (await db.query<Row>(`insert into agent_private.runs(user_id,request_key,request_hash,context,profile_hash,version)
        values($1,$2,$3,$4,$5,$6) returning *`, [userId, req.requestKey, contentHash(req.context), JSON.stringify(req.context), profileHash, P1_VERSION])).rows[0];
      await this.event(db, run, "run_created", "user", { context: req.context, version: P1_VERSION });
      return { ok: true, value: await this.view(db, run) };
    });
  }

  async planContext(userId: string, kind: PlanKind, draftId?: string, timezone="UTC"): Promise<PlanSnapshot> {
    const anchor=localDateAt(new Date(),timezone);
    return this.tx(userId, async db => {
      const profile = (await db.query("select to_jsonb(s) as data from public.user_settings s where user_id=$1 for share", [userId])).rows[0]?.data;
      if (!profile) throw new Error("PROFILE_REQUIRED");
      const currentPlans = await readPlanRows(db, userId, kind);
      if (JSON.stringify(currentPlans).length > 100000) throw new Error("PLAN_TOO_LARGE");
      const snapshot: PlanSnapshot = { kind, profile, currentPlans, profileHash: contentHash(profile), stateHash: contentHash(currentPlans) };
      snapshot.memory=await readPlanningMemory(db,userId,kind,anchor,timezone);
      const saved=(await db.query(`select p.plan,r.context from agent_private.receipts receipt
        join agent_private.runs r on r.id=receipt.run_id join agent_private.proposals p on p.id=receipt.proposal_id
        where receipt.user_id=$1 and r.kind=$2 and receipt.receipt->>'appliedStateHash'=$3 limit 1`,[userId,kind,snapshot.stateHash])).rows[0];
      if(saved)snapshot.editable={plan:saved.plan,context:saved.context};
      if (draftId) {
        const run = await this.run(db, userId, draftId);
        if (run && run.kind === kind && ["awaiting_approval", "approved", "revoked"].includes(run.status) && await this.fresh(db, run)) {
          const p = await this.proposal(db, run);
          if (p) {snapshot.draft = { runId: run.id, revision: run.revision, plan: p.plan };snapshot.editable={plan:p.plan,context:run.context};}
        }
      }
      return snapshot;
    });
  }

  // A model may publish a checked immutable preview, never approve or execute.
  // An optional note (e.g. the review a preview came from) is written in the same transaction.
  async prepare(userId: string, requestKey: string, snapshot: PlanSnapshot, context: Context, input: unknown,
    note?: { type: string; data: unknown }): Promise<Outcome<RunView>> {
    z.uuid().parse(requestKey); contextSchema.parse(context);
    const plan = (snapshot.kind === "training" ? planSchema : nutritionPlanSchema).parse(input);
    const memoryHash=snapshot.memory?contentHash(planningMemoryContent(snapshot.memory)):null;
    const requestHash = contentHash({ kind: snapshot.kind, plan, context, stateHash: snapshot.stateHash, profileHash: snapshot.profileHash,...(memoryHash?{memoryHash}:{}) });
    return this.tx(userId, async db => {
      const old = (await db.query<Row & {request_hash: string}>("select * from agent_private.runs where user_id=$1 and request_key=$2", [userId, requestKey])).rows[0];
      if (old) return old.request_hash === requestHash ? {ok: true, value: await this.view(db, old)} : fail("KEY_CONFLICT");
      if (await this.profile(db, userId) !== snapshot.profileHash || contentHash(await readPlanRows(db, userId, snapshot.kind)) !== snapshot.stateHash) return fail("CONTEXT_STALE");
      if(snapshot.memory&&contentHash(planningMemoryContent(await readPlanningMemory(db,userId,snapshot.kind,localDateAt(new Date(),snapshot.memory.timezone),snapshot.memory.timezone)))!==memoryHash)return fail("CONTEXT_STALE");
      if (!isNutritionPlan(plan) && validatePlanConstraints(plan, context).length) return fail("CONSTRAINT_VIOLATION");
      if (snapshot.draft) {
        const previous = await this.run(db, userId, snapshot.draft.runId);
        if (!previous || previous.kind !== snapshot.kind || previous.revision !== snapshot.draft.revision || !["awaiting_approval", "approved", "revoked"].includes(previous.status)) return fail("VERSION_CONFLICT");
        await db.query("update agent_private.runs set status='declined',approval_id=null,revision=revision+1 where id=$1", [previous.id]);
        await this.event(db, previous, "draft_superseded", "user_request");
      }
      const run = (await db.query<Row>(`insert into agent_private.runs(user_id,request_key,request_hash,context,profile_hash,version,kind,base_state_hash,baseline)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [userId,requestKey,requestHash,JSON.stringify(context),snapshot.profileHash,P1_VERSION,snapshot.kind,snapshot.stateHash,JSON.stringify(snapshot.currentPlans)])).rows[0];
      await this.event(db, run, "run_created", "user_request", {kind:snapshot.kind,context});
      if(snapshot.memory)await this.event(db,run,"planning_basis","system",{memoryHash,memory:snapshot.memory});
      const hash = contentHash(plan);
      const p = (await db.query(`insert into agent_private.proposals(user_id,run_id,version,context_revision,content_hash,plan)
        values($1,$2,1,0,$3,$4) returning id`, [userId,run.id,hash,JSON.stringify(plan)])).rows[0];
      await db.query("update agent_private.runs set current_proposal=$2,status='awaiting_approval',revision=1 where id=$1", [run.id,p.id]);
      await this.event(db, run, "proposal_published", "coach_model", {proposalId:p.id,contentHash:hash});
      if (note) await this.event(db, run, note.type, "system", note.data);
      return {ok:true,value:await this.view(db,run)};
    });
  }

  /** The caller's run made with this request key, so a retried request can return what the first one made. */
  async byRequestKey(userId: string, requestKey: string): Promise<RunView | null> {
    z.uuid().parse(requestKey);
    return this.tx(userId, async db => {
      const run = (await db.query<Row>("select * from agent_private.runs where user_id=$1 and request_key=$2", [userId, requestKey])).rows[0];
      return run ? this.view(db, run) : null;
    });
  }

  /** The latest event of one type on the caller's own run, or null. */
  async annotation(userId: string, id: string, type: string): Promise<unknown> {
    z.uuid().parse(id);
    return this.tx(userId, async db => (await db.query("select data from agent_private.events where user_id=$1 and run_id=$2 and type=$3 order by sequence desc limit 1",
      [userId, id, type])).rows[0]?.data ?? null);
  }

  async recent(userId: string): Promise<Outcome<RunView[]>> {
    return this.tx(userId, async db => {
      const runs = (await db.query<Row>(`select * from agent_private.runs where user_id=$1 and base_state_hash is not null
        and status in ('awaiting_approval','approved','revoked','applied','stale') order by created_at desc limit 5`, [userId])).rows;
      const views:RunView[] = [];
      const memoryCache=new Map<string,PlanningMemory>();
      for (const run of runs) {
        if (["awaiting_approval","approved","revoked"].includes(run.status)) await this.fresh(db,run,memoryCache);
        views.push(await this.view(db,run));
      }
      return {ok:true,value:views};
    });
  }
  async get(userId: string, id: string): Promise<Outcome<RunView>> {
    return this.tx(userId, async db => {
      const run = await this.run(db, userId, id);
      if (!run) return fail("NOT_FOUND");
      if (!["applied", "declined", "stale", "budget_exhausted"].includes(run.status)) await this.fresh(db, run);
      return { ok: true, value: await this.view(db, run) };
    });
  }
  async publish(userId: string, id: string, input: unknown): Promise<Outcome<RunView>> {
    const req = proposalRequestSchema.parse(input);
    return this.tx(userId, async db => {
      const run = await this.run(db, userId, id);
      if (!run) return fail("NOT_FOUND");
      if (run.revision !== req.expectedRevision) return fail("VERSION_CONFLICT");
      if (["applied", "declined", "budget_exhausted", "stale"].includes(run.status)) return fail("RUN_CLOSED");
      if (!(await this.fresh(db, run))) return fail("CONTEXT_STALE");
      if (isNutritionPlan(req.plan) !== (run.kind === "nutrition")) return fail("PLAN_KIND_MISMATCH");
      const violations = isNutritionPlan(req.plan) ? [] : validatePlanConstraints(req.plan, run.context);
      if (violations.length) {
        await this.event(db, run, "proposal_rejected", "validator", { violations });
        return fail("CONSTRAINT_VIOLATION");
      }
      const old = await this.proposal(db, run);
      const p = (await db.query(`insert into agent_private.proposals(user_id,run_id,version,context_revision,content_hash,plan)
        values($1,$2,$3,$4,$5,$6) returning id`, [userId, id, (old?.version ?? 0) + 1, run.context_revision, contentHash(req.plan), JSON.stringify(req.plan)])).rows[0];
      await db.query("update agent_private.runs set current_proposal=$2,approval_id=null,status='awaiting_approval',revision=revision+1 where id=$1", [id, p.id]);
      await this.event(db, run, "proposal_published", "draft_import", { proposalId: p.id, contentHash: contentHash(req.plan) });
      return { ok: true, value: await this.view(db, run) };
    });
  }

  // Only the authenticated user event route invokes this. The model tool adapter never does.
  async userEvent(userId: string, id: string, input: unknown): Promise<Outcome<RunView>> {
    const req = userEventSchema.parse(input);
    return this.tx(userId, async db => {
      const run = await this.run(db, userId, id);
      if (!run) return fail("NOT_FOUND");
      if (run.revision !== req.expectedRevision) return fail("VERSION_CONFLICT");
      if (["applied", "declined", "budget_exhausted"].includes(run.status)) return fail("RUN_CLOSED");
      if (req.action === "context") {
        if (run.base_state_hash) return fail("NEW_PREVIEW_REQUIRED");
        const profileHash = await this.profile(db, userId);
        if (!profileHash) return fail("PROFILE_REQUIRED");
        await db.query(`update agent_private.runs set context=$2,context_revision=context_revision+1,
          profile_hash=$3,approval_id=null,status='planning',revision=revision+1 where id=$1`, [id, JSON.stringify(req.context), profileHash]);
        await this.event(db, run, "context_updated", "user", { context: req.context });
      } else {
        if (!(await this.bound(db, run, req.binding))) return fail("PROPOSAL_MISMATCH");
        if (req.action === "approve" && !(await this.fresh(db, run))) return fail("CONTEXT_STALE");
        // Revocation is sticky for this proposal: a late/retried approval cannot revive it.
        if (req.action === "approve" && run.status !== "awaiting_approval") return fail("APPROVAL_NOT_AVAILABLE");
        const approvalId = req.action === "approve" ? randomUUID() : null;
        const status = req.action === "approve" ? "approved" : req.action === "revoke" ? "revoked" : "declined";
        await db.query("update agent_private.runs set status=$2,approval_id=$3,revision=revision+1 where id=$1", [id, status, approvalId]);
        await this.event(db, run, req.action, "user", { ...req.binding, approvalId });
      }
      return { ok: true, value: await this.view(db, run) };
    });
  }

  async execute(userId: string, id: string, input: unknown): Promise<Outcome<Receipt>> {
    const req = executeSchema.parse(input);
    return this.tx(userId, async db => {
      const run = await this.run(db, userId, id);
      if (!run) return fail("NOT_FOUND");
      const intentHash = contentHash({ runId: id, binding: req.binding, approvalId: req.approvalId });
      const old = (await db.query("select * from agent_private.execution_keys where user_id=$1 and key=$2", [userId, req.idempotencyKey])).rows[0];
      await db.query("update agent_private.runs set attempts=attempts+1 where id=$1", [id]);
      await this.event(db, run, "execute_attempt", "executor", { key: req.idempotencyKey, ...req.binding, approvalId: req.approvalId });
      const reject = async (code: string) => {
        await this.event(db, run, "execute_rejected", "database", { key: req.idempotencyKey, code });
        return fail(code);
      };
      if (old && old.intent_hash !== intentHash) return reject("KEY_CONFLICT");
      if (!old) await db.query("insert into agent_private.execution_keys(user_id,key,run_id,intent_hash) values($1,$2,$3,$4)", [userId, req.idempotencyKey, id, intentHash]);
      const receipt = (await db.query("select receipt from agent_private.receipts where run_id=$1", [id])).rows[0]?.receipt as Receipt | undefined;
      // A replay is a report of a past fact, even after later changes. It never writes a plan.
      if (receipt) {
        if (receipt.proposalId !== req.binding.proposalId || receipt.contentHash !== req.binding.contentHash ||
          receipt.contextRevision !== req.binding.contextRevision || receipt.approvalId !== req.approvalId) return reject("ALREADY_APPLIED");
        await this.event(db, run, "receipt_replayed", "database", { key: req.idempotencyKey, receiptId: receipt.id });
        return { ok: true, value: receipt };
      }
      if (run.attempts >= 64) {
        await db.query("update agent_private.runs set status='budget_exhausted',approval_id=null,revision=revision+1 where id=$1", [id]);
        return reject("BUDGET_EXHAUSTED");
      }
      const p = await this.bound(db, run, req.binding);
      if (!p) return reject("PROPOSAL_MISMATCH");
      if (run.status !== "approved" || run.approval_id !== req.approvalId) return reject("NOT_APPROVED");
      if (!(await this.fresh(db, run))) return reject("CONTEXT_STALE");
      if (contentHash(p.plan) !== p.content_hash || isNutritionPlan(p.plan) !== (run.kind === "nutrition") ||
        (!isNutritionPlan(p.plan) && validatePlanConstraints(p.plan, run.context).length)) return reject("PROPOSAL_INVALID");
      await db.query("savepoint business_write");
      try {
        const planId = `agent-${randomUUID()}`;
        if (isNutritionPlan(p.plan)) {
          await persistNutritionPlan(db, userId, planId, p.plan);
        } else {
        await db.query("update public.training_plans set is_active=false,updated_at=now() where user_id=$1 and is_active", [userId]);
        await db.query(`insert into public.training_plans(id,user_id,name,notes,is_active) values($1,$2,$3,$4,true)`,
          [planId, userId, p.plan.plan_name, [p.plan.summary, p.plan.reasoning_summary,
            `Goal: ${p.plan.goal_type}`, ...p.plan.warnings.map(w => `Note: ${w}`)].filter(Boolean).join("\n\n")]);
        const weeks: { id: string; training_plan_id: string; week_number: number }[] = [];
        const days: { id: string; week_id: string; day_number: number; title: string; notes: string }[] = [];
        const exercises: { id: string; day_id: string; name: string; sets: number; rep_range: string; target_rpe: number; notes: string; alternative_exercises: string[] }[] = [];
        for (const week of p.plan.weeks) {
          const weekId = `${planId}-w${week.week_number}`;
          weeks.push({ id: weekId, training_plan_id: planId, week_number: week.week_number });
          for (const day of week.days) {
            const dayId = `${weekId}-d${day.day_number}`;
            days.push({ id: dayId, week_id: weekId, day_number: day.day_number, title: day.title,
              notes: [week.focus, day.notes, `Estimated duration: ${day.estimated_duration_minutes} min`].filter(Boolean).join("\n") });
            for (const [i, ex] of day.exercises.entries()) exercises.push({ id: `${dayId}-e${i+1}`, day_id: dayId, name: ex.name,
              sets: ex.sets, rep_range: ex.rep_range, target_rpe: ex.target_rpe,
              notes: [ex.notes, `Rest: ${ex.rest_seconds}s`].filter(Boolean).join("\n"), alternative_exercises: ex.alternative_exercises });
          }
        }
        // Three bounded batch inserts, not one network round trip per exercise.
        await db.query(`insert into public.training_plan_weeks(id,training_plan_id,week_number) select * from jsonb_to_recordset($1::jsonb)
          as x(id text,training_plan_id text,week_number integer)`, [JSON.stringify(weeks)]);
        await db.query(`insert into public.training_plan_days(id,week_id,day_number,title,notes) select * from jsonb_to_recordset($1::jsonb)
          as x(id text,week_id text,day_number integer,title text,notes text)`, [JSON.stringify(days)]);
        await db.query(`insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe,notes,alternative_exercises) select * from jsonb_to_recordset($1::jsonb)
          as x(id text,day_id text,name text,sets integer,rep_range text,target_rpe numeric,notes text,alternative_exercises text[])`, [JSON.stringify(exercises)]);
        }
        const timestamp = (await db.query("select clock_timestamp() as at")).rows[0].at.toISOString();
        const result: Receipt = { id: randomUUID(), runId: id, proposalId: p.id, contentHash: p.content_hash,
          approvalId: req.approvalId, contextRevision: p.context_revision, planId, committedAt: timestamp, kind: run.kind ?? "training",
          appliedStateHash:contentHash(await readPlanRows(db,userId,run.kind??"training")) };
        await db.query("insert into agent_private.receipts(id,user_id,run_id,proposal_id,receipt) values($1,$2,$3,$4,$5)", [result.id, userId, id, p.id, JSON.stringify(result)]);
        await db.query("update agent_private.runs set status='applied',revision=revision+1 where id=$1", [id]);
        await this.event(db, run, "plan_committed", "database", result);
        await db.query("release savepoint business_write");
        return { ok: true, value: result };
      } catch (error) {
        await db.query("rollback to savepoint business_write");
        // Preserve the attempt, not partial business rows. No secret SQL/error text in events.
        await this.event(db, run, "write_rolled_back", "database", { code: (error as { code?: string }).code ?? "unknown" });
        return fail("WRITE_ROLLED_BACK", true);
      }
    });
  }
}
