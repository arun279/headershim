import type { ComponentChildren } from "preact";
import { browser } from "wxt/browser";
import type { StateDoc } from "../../../src/core/model";
import { sentence } from "../../../src/ui/components/sentence";
import { copy } from "../../../src/ui/copy";
import type { Mutations } from "../../../src/ui/state/mutations";
import "./About.css";

const text = copy.options.about;
const SHORTCUTS_URL = "chrome://extensions/shortcuts";

/**
 * Appearance settings and the trust page: the permission justification
 * table, the never-list, and the build-verification procedure — prose a
 * security reviewer can paste into an approval request.
 */
export function AboutPage({
  doc,
  mutations,
}: {
  doc: StateDoc;
  mutations: Mutations;
}) {
  return (
    <section class="page" aria-labelledby="about-title">
      <h1 class="page-title" id="about-title">
        {copy.options.nav.about}
      </h1>

      <div class="about-card">
        <h2 class="silk">{text.appearanceHeading}</h2>
        <RadioGroup
          label={text.theme.label}
          name="theme"
          value={doc.settings.theme}
          options={text.theme.options}
          onChange={(theme) => void mutations.setTheme(theme)}
        />
        <RadioGroup
          label={text.badgeMode.label}
          name="badge-mode"
          value={doc.settings.badgeMode}
          options={text.badgeMode.options}
          onChange={(badgeMode) => void mutations.setBadgeMode(badgeMode)}
        />
        <div>
          <button
            type="button"
            class="about-link-button"
            onClick={() => void browser.tabs.create({ url: SHORTCUTS_URL })}
          >
            {text.shortcuts}
            <span aria-hidden="true"> ↗</span>
          </button>
        </div>
      </div>

      <div class="about-card">
        <h2 class="silk">{text.trustHeading}</h2>
        <p class="about-build">
          {sentence(
            text.build(browser.runtime.getManifest().version, __COMMIT__),
          )}
        </p>
        <p>{copy.app.tagline}</p>

        <h3 class="silk about-group">{text.permissions.heading}</h3>
        <p>{text.permissions.intro}</p>
        <div class="about-table-scroll">
          <table class="about-table">
            <thead>
              <tr>
                <th scope="col">{text.permissions.columns.permission}</th>
                <th scope="col">{text.permissions.columns.why}</th>
                <th scope="col">{text.permissions.columns.when}</th>
              </tr>
            </thead>
            <tbody>
              {text.permissions.rows.map((row) => (
                <tr key={row.permission}>
                  <th scope="row" class="mono">
                    {row.permission}
                  </th>
                  <td>{row.why}</td>
                  <td>{row.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 class="silk about-group">{text.storage.heading}</h3>
        <p>{text.storage.body}</p>

        <h3 class="silk about-group">{text.neverList.heading}</h3>
        <p>{text.neverList.intro}</p>
        <ul class="about-never">
          {text.neverList.items.map((item) => (
            <li key={item.lead}>
              <strong>{item.lead}</strong> — {item.detail}
            </li>
          ))}
        </ul>

        <h3 class="silk about-group">{text.verifyBuild.heading}</h3>
        <p>{text.verifyBuild.intro}</p>
        <ol class="about-steps">
          {text.verifyBuild.steps.map((step) => (
            <li key={step[0]}>{sentence(step)}</li>
          ))}
        </ol>
        <p>{text.verifyBuild.caveat}</p>

        <p class="about-links">
          {text.links.license}
          {" · "}
          <ExternalLink href={text.links.repositoryUrl}>
            {text.links.repository}
          </ExternalLink>
          {" · "}
          <ExternalLink href={text.links.issuesUrl}>
            {text.links.issues}
          </ExternalLink>
          {" · "}
          <ExternalLink href={text.links.changelogUrl}>
            {text.links.changelog}
          </ExternalLink>
        </p>
      </div>
    </section>
  );
}

function RadioGroup<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: Readonly<Record<T, string>>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="about-radios">
      <legend>{label}</legend>
      {(Object.entries(options) as [T, string][]).map(([key, optionLabel]) => (
        <label key={key} class="about-radio">
          <input
            type="radio"
            name={name}
            value={key}
            checked={key === value}
            onChange={() => onChange(key)}
          />
          {optionLabel}
        </label>
      ))}
    </fieldset>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ComponentChildren;
}) {
  return (
    <a class="about-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}
