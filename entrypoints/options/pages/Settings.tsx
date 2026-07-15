import { browser } from "wxt/browser";
import type { StateDoc } from "../../../src/core/model";
import { copy } from "../../../src/ui/copy";
import type { Mutations } from "../../../src/ui/state/mutations";
import { applyTheme, type Theme } from "../../../src/ui/theme";
import "./Settings.css";

const text = copy.options.settings;
export function shortcutManagerUrl(runtime: object): string {
  return "getBrowserInfo" in runtime
    ? "about:addons"
    : "chrome://extensions/shortcuts";
}

export function SettingsPage({
  doc,
  mutations,
}: {
  doc: StateDoc;
  mutations: Mutations;
}) {
  const shortcutsUrl = shortcutManagerUrl(browser.runtime);
  return (
    <section class="page settings-page" aria-labelledby="settings-title">
      <h1 class="page-title" id="settings-title" tabIndex={-1}>
        {text.title}
      </h1>

      <div class="settings-card">
        <fieldset class="settings-row settings-radios">
          <legend>{text.theme.label}</legend>
          {(Object.entries(text.theme.options) as [Theme, string][]).map(
            ([value, label]) => (
              <label key={value} class="settings-radio">
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={doc.settings.theme === value}
                  onChange={() => {
                    applyTheme(value);
                    void mutations.setTheme(value);
                  }}
                />
                {label}
              </label>
            ),
          )}
        </fieldset>

        <fieldset class="settings-row settings-radios">
          <legend>{text.badgeMode.label}</legend>
          {(
            Object.entries(text.badgeMode.options) as [
              StateDoc["settings"]["badgeMode"],
              string,
            ][]
          ).map(([value, label]) => (
            <label key={value} class="settings-radio">
              <input
                type="radio"
                name="badge-mode"
                value={value}
                checked={doc.settings.badgeMode === value}
                onChange={() => void mutations.setBadgeMode(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <div class="settings-row settings-shortcuts">
          <a
            class="settings-link"
            href={shortcutsUrl}
            onClick={(event) => {
              event.preventDefault();
              void browser.tabs.create({ url: shortcutsUrl });
            }}
          >
            {text.shortcuts}
            <span aria-hidden="true"> ↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
