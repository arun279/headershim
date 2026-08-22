import { useEffect, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import type { GrantSnapshot } from "../../../src/core/grants";
import type { StateDoc } from "../../../src/core/model";
import { createV1Seed } from "../../../src/core/schema";
import { remove as removePermissions } from "../../../src/platform/permissions";
import { clearOverrides } from "../../../src/platform/session-store";
import { Button } from "../../../src/ui/components/Button";
import { Modal } from "../../../src/ui/components/Modal";
import { Segmented } from "../../../src/ui/components/Segmented";
import { ToastHost } from "../../../src/ui/components/Toast";
import { copy } from "../../../src/ui/copy";
import { copy as optionsCopy } from "../../../src/ui/copy.options";
import type { Mutations } from "../../../src/ui/state/mutations";
import { useToast } from "../../../src/ui/state/useToast";
import { applyTheme, type Theme } from "../../../src/ui/theme";
import "./Settings.css";

const text = optionsCopy.options.settings;
export function shortcutManagerUrl(runtime: object): string {
  return "getBrowserInfo" in runtime
    ? "about:addons"
    : "chrome://extensions/shortcuts";
}

export function SettingsPage({
  doc,
  grants,
  mutations,
}: {
  doc: StateDoc;
  grants: GrantSnapshot;
  mutations: Mutations;
}) {
  const shortcutsUrl = shortcutManagerUrl(browser.runtime);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const { toast, show, showUndoable, flash, dismiss } = useToast();

  // The bound key for each command, read back from the browser so the row shows
  // the shortcut a user actually has (including any they rebound) rather than a
  // link that hides them behind another page. Chrome does not return a label for
  // the reserved action command, so the labels come from copy and only the key
  // is read here.
  useEffect(() => {
    void browser.commands.getAll().then((commands) => {
      const bound: Record<string, string> = {};
      for (const command of commands) {
        if (command.name !== undefined) {
          bound[command.name] = command.shortcut ?? "";
        }
      }
      setKeys(bound);
    });
  }, []);

  // A clean slate spans all three stores the product keeps: the seed replaces
  // the document, every grant is revoked, and every tab's live overrides are
  // dropped. Undo restores the document alone: a revoked grant needs its own
  // gesture to return, and a live override belongs to its tab, not to a saved
  // document.
  const erase = async () => {
    setConfirmErase(false);
    try {
      const outcome = await mutations.replaceDoc(createV1Seed());
      if (!outcome.ok) {
        flash(outcome.error);
        return;
      }
      await Promise.all([
        removePermissions([...grants.origins]),
        clearOverrides(),
      ]);
      showUndoable(text.eraseAll.done, () =>
        mutations.replaceDoc(outcome.value),
      );
      titleRef.current?.focus();
    } catch {
      show(copy.errors.eraseFailed);
    }
  };

  return (
    <section class="wb-page settings-page" aria-labelledby="settings-title">
      <h1 class="wb-title" id="settings-title" ref={titleRef} tabIndex={-1}>
        {text.title}
      </h1>

      <div class="settings-card">
        <fieldset class="settings-row settings-radios">
          <legend>{text.theme.label}</legend>
          <Segmented
            semantics="radio"
            name="theme"
            label={text.theme.label}
            value={doc.settings.theme}
            options={(
              Object.entries(text.theme.options) as [Theme, string][]
            ).map(([value, label]) => ({ value, label }))}
            onChange={(value) => {
              applyTheme(value);
              void mutations.setTheme(value);
            }}
          />
        </fieldset>

        <div class="settings-row settings-shortcuts">
          <div class="shortcuts-head">
            <span class="settings-label">{text.shortcuts}</span>
            <a
              class="settings-link"
              href={shortcutsUrl}
              onClick={(event) => {
                event.preventDefault();
                void browser.tabs.create({ url: shortcutsUrl });
              }}
            >
              {text.shortcutsManage}
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>
          <ul class="shortcut-list">
            {text.commands.map((command) => {
              const key = keys[command.name];
              return (
                <li key={command.name}>
                  <span class="shortcut-desc">{command.label}</span>
                  {key === undefined ? null : key === "" ? (
                    <span class="shortcut-unset">{text.shortcutUnset}</span>
                  ) : (
                    <span class="kbd mono">{key}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div class="settings-row">
          <Button kind="quiet" onClick={() => setConfirmErase(true)}>
            {text.eraseAll.action}
          </Button>
        </div>
      </div>

      {confirmErase && (
        <Modal
          title={text.eraseAll.confirmTitle}
          onClose={() => setConfirmErase(false)}
          initialFocus={cancelRef}
        >
          <p class="modal-text">{text.eraseAll.confirmBody}</p>
          <div class="modal-actions">
            <button
              type="button"
              class="btn quiet"
              ref={cancelRef}
              onClick={() => setConfirmErase(false)}
            >
              {copy.actions.cancel}
            </button>
            <Button kind="destructive" onClick={erase}>
              {text.eraseAll.action}
            </Button>
          </div>
        </Modal>
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </section>
  );
}
