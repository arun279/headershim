import type { ComponentChildren } from "preact";
import { browser } from "wxt/browser";
import { sentence } from "../../../src/ui/components/sentence";
import { copy } from "../../../src/ui/copy";
import "./About.css";

const text = copy.options.about;

/** Permission justification, trust commitments, and build verification. */
export function AboutPage() {
  return (
    <section class="page" aria-labelledby="about-title">
      <h1 class="page-title" id="about-title" tabIndex={-1}>
        {copy.options.nav.about}
      </h1>

      <div class="about-card">
        <h2 class="silk">{text.trustHeading}</h2>
        <p class="about-build">
          {sentence(
            text.build(browser.runtime.getManifest().version, __COMMIT__),
          )}
        </p>
        <p>{copy.app.tagline}</p>

        <h3 class="silk about-group">{text.summary.heading}</h3>
        <ol class="about-facts">
          {text.summary.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ol>

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
        {text.neverList.groups.map((group) => (
          <div key={group.heading} class="about-never-group">
            <h4 class="about-never-heading">{group.heading}</h4>
            <ul class="about-never">
              {group.items.map((item) => (
                <li key={item.lead}>
                  <strong>{item.lead}.</strong> {item.detail}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <h3 class="silk about-group">{text.security.heading}</h3>
        <p>
          {text.security.body}{" "}
          <ExternalLink href={text.security.linkUrl}>
            {text.security.linkLabel}
          </ExternalLink>
        </p>

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
