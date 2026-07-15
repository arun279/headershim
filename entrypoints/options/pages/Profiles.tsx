import { useEffect, useRef, useState } from "preact/hooks";
import { availableProfileName } from "../../../src/core/codec/headershim";
import {
  domainFromOriginPattern,
  type GrantSnapshot,
} from "../../../src/core/grants";
import { shouldShowRuleCountWarning } from "../../../src/core/limits";
import {
  BADGE_COLORS,
  type Profile,
  type Rule,
  type StateDoc,
} from "../../../src/core/model";
import type { Result } from "../../../src/core/result";
import { isRegexSupported } from "../../../src/platform/dnr";
import { request as requestPermissions } from "../../../src/platform/permissions";
import { useAnnounce } from "../../../src/ui/a11y/LiveRegion";
import { Button } from "../../../src/ui/components/Button";
import { Modal } from "../../../src/ui/components/Modal";
import { ProfileList } from "../../../src/ui/components/ProfileList";
import { ProfileRulesPanel } from "../../../src/ui/components/ProfileRulesPanel";
import { Toast } from "../../../src/ui/components/Toast";
import { copy } from "../../../src/ui/copy";
import { blockedCommitCopy } from "../../../src/ui/state/commit-copy";
import type { MutationError, Mutations } from "../../../src/ui/state/mutations";
import { useInvalidRules } from "../../../src/ui/state/useInvalidRules";
import "./Profiles.css";

type Undo =
  | { kind: "profile"; profile: Profile; index: number }
  | {
      kind: "rules";
      profileId: string;
      removed: readonly { rule: Rule; index: number }[];
    };

/**
 * The Profiles management page: create, rename, clone, delete (confirm + undo),
 * reorder, badge editing, and bulk rule actions — all through the shared
 * mutations API, which enforces the caps and byte budget inside its lock.
 */
export function ProfilesPage({
  doc,
  grants,
  mutations,
}: {
  doc: StateDoc;
  grants: GrantSnapshot;
  mutations: Mutations;
}) {
  const [openId, setOpenId] = useState(doc.focusedProfileId);
  const [editing, setEditing] = useState<
    { profileId: string; ruleId: string | undefined } | undefined
  >(undefined);
  const [Editor, setEditor] =
    useState<
      typeof import("../../../src/ui/components/RuleEditor").RuleEditor
    >();
  const [confirmDelete, setConfirmDelete] = useState<Profile | undefined>(
    undefined,
  );
  const [toast, setToast] = useState<string | undefined>(undefined);
  const [undo, setUndo] = useState<Undo | undefined>(undefined);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const announce = useAnnounce();
  const invalidRuleIds = useInvalidRules(doc.profiles, isRegexSupported);
  useEffect(() => {
    void import("../../../src/ui/components/RuleEditor").then((module) =>
      setEditor(() => module.RuleEditor),
    );
  }, []);
  // A freshly mounted role=status toast is not reliably re-announced, so every
  // toast also speaks through the persistent polite region.
  const showToast = (message: string) => {
    setToast(message);
    announce(message);
  };

  const open =
    doc.profiles.find((profile) => profile.id === openId) ??
    doc.profiles.find((profile) => profile.id === doc.focusedProfileId) ??
    doc.profiles[0];
  // The store always seeds at least one profile (deleting the last recreates
  // Default), so an empty document never reaches render.
  if (open === undefined) {
    return null;
  }

  // Passive counter, appears only past 4,000 of the 4,500 enabled-rule cap;
  // the count mirrors the enabled set the cap governs.
  const enabledRuleCount = doc.profiles
    .filter((profile) => profile.enabled)
    .reduce(
      (total, profile) =>
        total + profile.rules.filter((rule) => rule.enabled).length,
      0,
    );

  const flash = (error: MutationError) => {
    const message = blockedCommitCopy(error);
    if (message !== undefined) {
      showToast(message);
    }
  };

  const showGrantToast = (sites: readonly string[]) => {
    showToast(
      sites.length === 1
        ? copy.toast.activeOn(sites[0] as string)
        : copy.toast.activeOnSites(sites.length),
    );
  };

  const openEditor = (ruleId: string | undefined) => {
    setEditing({ profileId: open.id, ruleId });
  };

  const grant = (origins: readonly string[]) => {
    const granted = requestPermissions([...origins]);
    void granted.then((allowed) => {
      if (!allowed) {
        return;
      }
      showGrantToast(
        origins.map((origin) => domainFromOriginPattern(origin) ?? origin),
      );
    });
  };

  // A successful commit retires any pending undo; a blocked one surfaces its
  // copy and leaves the undo intact.
  const run = <T,>(mutation: Promise<Result<T, MutationError>>) => {
    void mutation.then((outcome) => {
      if (outcome.ok) {
        setUndo(undefined);
      } else {
        flash(outcome.error);
      }
    });
  };

  const create = () => {
    const name = availableProfileName(
      copy.options.profiles.newName,
      doc.profiles,
      [],
    );
    void mutations
      .createProfile({
        name,
        color:
          BADGE_COLORS[doc.profiles.length % BADGE_COLORS.length] ??
          BADGE_COLORS[0],
        enabled: false,
      })
      .then((outcome) => {
        if (outcome.ok) {
          setUndo(undefined);
          setOpenId(outcome.value.id);
        } else {
          flash(outcome.error);
        }
      });
  };

  const clone = (profileId: string) => {
    void mutations.cloneProfile(profileId).then((outcome) => {
      if (outcome.ok) {
        setUndo(undefined);
        setOpenId(outcome.value.id);
      } else {
        flash(outcome.error);
      }
    });
  };

  const deleteProfile = (profile: Profile) => {
    setConfirmDelete(undefined);
    void mutations.deleteProfile(profile.id).then((outcome) => {
      if (!outcome.ok) {
        flash(outcome.error);
        return;
      }
      setUndo({ kind: "profile", ...outcome.value });
      showToast(copy.toast.profileDeleted(profile.name));
      // The confirm modal restored focus to the now-unmounting profile card's
      // Delete button; land it on the stable page heading instead of <body>
      // (WCAG 2.4.3).
      titleRef.current?.focus();
    });
  };

  const deleteRules = (ruleIds: readonly string[]) => {
    void mutations.deleteRules(open.id, ruleIds).then((outcome) => {
      if (!outcome.ok) {
        flash(outcome.error);
        return;
      }
      setUndo({
        kind: "rules",
        profileId: open.id,
        removed: outcome.value.removed,
      });
      showToast(copy.toast.rulesDeleted(outcome.value.removed.length));
    });
  };

  const discardEditingRule = async (ruleId: string): Promise<void> => {
    const outcome = await mutations.deleteRule(open.id, ruleId);
    if (!outcome.ok) {
      flash(outcome.error);
    }
  };

  const editingRule =
    editing?.profileId === open.id && editing.ruleId !== undefined
      ? open.rules.find((rule) => rule.id === editing.ruleId)
      : undefined;
  const editorOpen =
    editing?.profileId === open.id &&
    (editing.ruleId === undefined || editingRule !== undefined);

  const runUndo = () => {
    if (undo === undefined) {
      return;
    }
    const mutation =
      undo.kind === "profile"
        ? mutations.restoreProfile(undo.profile, undo.index)
        : mutations.restoreRules(undo.profileId, undo.removed);
    void mutation.then((outcome) => {
      setUndo(undefined);
      const message = outcome.ok ? undefined : blockedCommitCopy(outcome.error);
      if (message === undefined) {
        setToast(undefined);
      } else {
        showToast(message);
      }
    });
  };

  return (
    <section class="page" aria-labelledby="profiles-title">
      <div class="page-head">
        <div>
          <h1
            class="page-title"
            id="profiles-title"
            ref={titleRef}
            tabIndex={-1}
          >
            {copy.options.profiles.title}
          </h1>
          {shouldShowRuleCountWarning(enabledRuleCount) && (
            <p class="rule-counter">
              {copy.errors.ruleCounter(enabledRuleCount)}
            </p>
          )}
        </div>
      </div>

      <div class="profiles-workspace">
        <aside
          class="profile-master"
          aria-label={copy.options.profiles.listLabel}
        >
          <div class="profile-master-head">
            <span class="silk">{copy.options.profiles.listLabel}</span>
            <button
              type="button"
              class="profile-add"
              aria-label={copy.options.profiles.new}
              title={copy.options.profiles.new}
              onClick={create}
            >
              ＋
            </button>
          </div>
          <ProfileList
            profiles={doc.profiles}
            openProfileId={open.id}
            onOpen={(profileId) => {
              setEditing(undefined);
              setOpenId(profileId);
            }}
            onToggle={(id, enabled) =>
              run(mutations.setProfileEnabled(id, enabled))
            }
            onReorder={(id, toIndex) =>
              run(mutations.reorderProfile(id, toIndex))
            }
            onRename={(id, name) => run(mutations.renameProfile(id, name))}
            onClone={clone}
            onDelete={(id) => {
              const profile = doc.profiles.find(
                (candidate) => candidate.id === id,
              );
              if (profile !== undefined) {
                setConfirmDelete(profile);
              }
            }}
            onBadgeChange={(id, badgeText, color) =>
              run(mutations.setProfileBadge(id, { badgeText, color }))
            }
          />
        </aside>

        <div class="profile-detail-pane">
          {editorOpen && Editor !== undefined ? (
            <Editor
              key={`${open.id}:${editing?.ruleId ?? "new"}`}
              profileName={open.name}
              rule={editingRule}
              grants={grants}
              modal={false}
              onSave={(ruleId, draft) =>
                mutations.saveRule(open.id, ruleId, draft)
              }
              onRequestGrant={requestPermissions}
              onGranted={showGrantToast}
              onCommitted={(kind) =>
                showToast(
                  kind === "create"
                    ? copy.toast.ruleCreated
                    : copy.toast.changesSaved,
                )
              }
              onDiscardRule={discardEditingRule}
              onClose={() => setEditing(undefined)}
            />
          ) : (
            <ProfileRulesPanel
              profile={open}
              grants={grants}
              invalidRuleIds={invalidRuleIds}
              moveTargets={doc.profiles.filter(
                (profile) => profile.id !== open.id,
              )}
              onSetEnabled={(ruleIds, enabled) =>
                run(mutations.setRulesEnabled(open.id, ruleIds, enabled))
              }
              onDelete={deleteRules}
              onMove={(ruleIds, toProfileId) =>
                run(mutations.moveRulesToProfile(open.id, ruleIds, toProfileId))
              }
              onCreate={() => openEditor(undefined)}
              onEdit={openEditor}
              onGrant={grant}
            />
          )}
        </div>
      </div>

      {confirmDelete !== undefined && (
        <Modal
          title={copy.options.profiles.deleteConfirm.title(confirmDelete.name)}
          onClose={() => setConfirmDelete(undefined)}
          initialFocus={cancelDeleteRef}
        >
          <p class="modal-text">
            {copy.options.profiles.deleteConfirm.body(
              confirmDelete.rules.length,
            )}
          </p>
          <div class="modal-actions">
            <button
              type="button"
              class="btn quiet"
              ref={cancelDeleteRef}
              onClick={() => setConfirmDelete(undefined)}
            >
              {copy.actions.cancel}
            </button>
            <Button kind="primary" onClick={() => deleteProfile(confirmDelete)}>
              {copy.options.profiles.deleteConfirm.confirm}
            </Button>
          </div>
        </Modal>
      )}

      {toast !== undefined && (
        <Toast
          onDismiss={() => setToast(undefined)}
          // While an undo is live the toast holds open (no 6s timer), so the
          // Undo control stays reachable until the next mutation retires it —
          // the options page's persistent-undo affordance (WCAG 2.2.1).
          persist={undo !== undefined}
          actionLabel={undo !== undefined ? copy.actions.undo : undefined}
          onAction={undo !== undefined ? runUndo : undefined}
        >
          {toast}
        </Toast>
      )}
    </section>
  );
}
