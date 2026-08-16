import { emitRules, revisionOf } from "../core/compile";
import { planReconcile } from "../core/reconcile";
import { migrate } from "../core/schema";
import { resolveRegexSupport } from "../platform/dnr";
import { FakeDnr } from "../platform/dnr.fake";
import {
  snapshot as grantSnapshot,
  onChanged as onGrantsChanged,
} from "../platform/permissions";
import {
  read as readSession,
  setAppliedRevision,
  subscribe as subscribeSession,
} from "../platform/session-store";
import { readRaw, subscribe as subscribeState } from "../platform/store";

const dnr = new FakeDnr();
let stopFollowing = () => undefined;

async function publishCurrentBatch(): Promise<void> {
  const outcome = migrate(await readRaw());
  if (!outcome.ok) return;
  const desired = emitRules({
    doc: outcome.value,
    overrides: Object.values((await readSession()).tabs).flat(),
    granted: await grantSnapshot(),
    isRegexSupported: await resolveRegexSupport(outcome.value),
  });
  const [dynamic, session] = await Promise.all([
    dnr.getDynamicRules(),
    dnr.getSessionRules(),
  ]);
  const dynamicPlan = planReconcile(desired.dynamic, dynamic);
  const sessionPlan = planReconcile(desired.session, session);
  if (dynamicPlan !== null) await dnr.updateDynamicRules(dynamicPlan);
  if (sessionPlan !== null) await dnr.updateSessionRules(sessionPlan);
  const installed = await Promise.all([
    dnr.getDynamicRules(),
    dnr.getSessionRules(),
  ]);
  await setAppliedRevision(await revisionOf(installed[0], installed[1]));
}

export async function followCurrentBatch(): Promise<void> {
  stopFollowing();
  const publish = () => void publishCurrentBatch();
  const subscriptions = [
    subscribeState(publish),
    subscribeSession(publish),
    onGrantsChanged(publish),
  ];
  stopFollowing = () => {
    for (const unsubscribe of subscriptions) unsubscribe();
    stopFollowing = () => undefined;
  };
  await publishCurrentBatch();
}

export function stopFollowingCurrentBatch(): void {
  stopFollowing();
}
