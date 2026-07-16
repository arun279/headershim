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
    <section class="wb-page settings-page" aria-labelledby="settings-title">
      <div>
        <h1 class="wb-title" id="settings-title" tabIndex={-1}>
          {text.title}
        </h1>
        <p class="wb-sub">{text.subtitle}</p>
      </div>

      <div class="settings-card">
        <fieldset class="settings-row settings-radios">
          <legend>{text.theme.label}</legend>
          <div
            class="settings-segments"
            role="radiogroup"
            aria-label={text.theme.label}
          >
            {(Object.entries(text.theme.options) as [Theme, string][]).map(
              ([value, label]) => (
                <label
                  key={value}
                  class={
                    doc.settings.theme === value
                      ? "settings-segment checked"
                      : "settings-segment"
                  }
                >
                  <input
                    class="sr-only"
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
          </div>
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
