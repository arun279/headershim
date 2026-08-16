import { useRef, useState } from "preact/hooks";
import { shouldShowRuleCountWarning } from "../../../src/core/limits";
import {
  activeProfile,
  availableProfileName,
  type Profile,
  type StateDoc,
} from "../../../src/core/model";
import type { Result } from "../../../src/core/result";
import { Button } from "../../../src/ui/components/Button";
import { Modal } from "../../../src/ui/components/Modal";
import { ProfileList } from "../../../src/ui/components/ProfileList";
import { PlusGlyph } from "../../../src/ui/components/readout/glyphs";
import { ToastHost } from "../../../src/ui/components/Toast";
import { copy } from "../../../src/ui/copy";
import type { MutationError, Mutations } from "../../../src/ui/state/mutations";
import { useToast } from "../../../src/ui/state/useToast";
import "./Profiles.css";

const text = copy.options.profiles;

/**
 * Profile management: create, rename, clone, delete (confirm + undo), reorder,
 * badge editing, and activation. Deleting a profile takes every rule in it, so
 * that one keeps its confirmation where a rule delete needs only an undo.
 */
export function ProfilesPage({
  doc,
  paused,
  mutations,
}: {
  doc: StateDoc;
  paused: boolean;
  mutations: Mutations;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<Profile | undefined>(
    undefined,
  );
  const { toast, showUndoable, flash, dismiss } = useToast();
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  const run = <T,>(mutation: Promise<Result<T, MutationError>>) => {
    void mutation.then((outcome) => {
      if (outcome.ok) {
        dismiss();
      } else {
        flash(outcome.error);
      }
    });
  };

  const enabledRuleCount = activeProfile(doc).rules.filter(
    (rule) => rule.enabled,
  ).length;

  const create = () => {
    void mutations
      .createProfile(availableProfileName(text.newName, doc.profiles))
      .then((outcome) => {
        if (outcome.ok) {
          dismiss();
          setOpenId(outcome.value.id);
        } else {
          flash(outcome.error);
        }
      });
  };

  const clone = (profileId: string) =>
    void mutations.cloneProfile(profileId).then((outcome) => {
      if (outcome.ok) {
        dismiss();
        setOpenId(outcome.value.id);
      } else {
        flash(outcome.error);
      }
    });

  const deleteProfile = (profile: Profile) => {
    setConfirmDelete(undefined);
    void mutations.deleteProfile(profile.id).then((outcome) => {
      if (!outcome.ok) {
        flash(outcome.error);
        return;
      }
      showUndoable(
        outcome.value.placeholderProfileId === undefined
          ? copy.toast.profileDeleted(profile.name)
          : copy.toast.lastProfileDeleted(profile.name),
        () => mutations.restoreProfile(outcome.value),
      );
      titleRef.current?.focus();
    });
  };

  return (
    <section class="wb-page profiles-page" aria-labelledby="profiles-title">
      <div class="wb-head">
        <div>
          <h1 class="wb-title" id="profiles-title" ref={titleRef} tabIndex={-1}>
            {text.title}
          </h1>
          {shouldShowRuleCountWarning(enabledRuleCount) && (
            <p class="rule-counter">
              {copy.errors.ruleCounter(enabledRuleCount)}
            </p>
          )}
        </div>
        <Button kind="primary" onClick={create}>
          <PlusGlyph />
          {copy.options.profiles.newProfile}
        </Button>
      </div>

      <div class="profiles-card">
        <ProfileList
          profiles={doc.profiles}
          activeProfileId={doc.activeProfileId}
          paused={paused}
          openProfileId={openId}
          onOpen={setOpenId}
          onActivate={(id) => run(mutations.activateProfile(id))}
          onReorder={(id, toIndex) =>
            run(mutations.reorderProfile(id, toIndex))
          }
          onRename={(id, name) => run(mutations.renameProfile(id, name))}
          onClone={clone}
          onDelete={(id) => {
            const profile = doc.profiles.find(
              (candidate) => candidate.id === id,
            );
            if (profile !== undefined) setConfirmDelete(profile);
          }}
          onBadgeChange={(id, badgeText, color) =>
            run(mutations.setProfileBadge(id, { badgeText, color }))
          }
        />
      </div>

      {confirmDelete !== undefined && (
        <Modal
          title={text.deleteConfirm.title(confirmDelete.name)}
          onClose={() => setConfirmDelete(undefined)}
          initialFocus={cancelDeleteRef}
        >
          <p class="modal-text">
            {text.deleteConfirm.body(confirmDelete.rules.length)}
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
            <Button
              kind="destructive"
              onClick={() => deleteProfile(confirmDelete)}
            >
              {text.deleteConfirm.confirm}
            </Button>
          </div>
        </Modal>
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </section>
  );
}
