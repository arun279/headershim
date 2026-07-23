import type { ComponentChildren } from "preact";
import { browser } from "wxt/browser";
import { sentence } from "../../../src/ui/components/sentence";
import { copy } from "../../../src/ui/copy";
import "./About.css";

const text = copy.options.about;

/**
 * A compact identity card with the build, product description, and links, and
 * beneath it the permissions the manifest declares plus the site access asked
 * for at runtime. Each row is headed by what the permission does in the words
 * the rest of the product uses, with the manifest id beside it so the mapping
 * stays exact; the feature it serves leads and the specifics sit under that one
 * fact per line, so a reader scanning for one of them stops at it. The h2 names
 * the list, so the list carries no label of its own to say it twice.
 */
export function AboutPage() {
  return (
    <section class="wb-page about-page" aria-labelledby="about-title">
      <h1 class="wb-title" id="about-title" tabIndex={-1}>
        {text.title}
      </h1>
      <div class="about-card">
        <p class="about-build">
          {sentence(
            text.build(browser.runtime.getManifest().version, __COMMIT__),
          )}
        </p>
        <p class="about-description">{text.description}</p>
        <p>{text.license}</p>

        <p class="about-links">
          <ExternalLink href={text.links.repositoryUrl}>
            {text.links.repository}
          </ExternalLink>
          {" · "}
          <ExternalLink href={text.links.privacyUrl}>
            {text.links.privacy}
          </ExternalLink>
          {" · "}
          <ExternalLink href={text.links.licenseUrl}>
            {text.links.license}
          </ExternalLink>
          {" · "}
          <ExternalLink href={text.links.issuesUrl}>
            {text.links.issues}
          </ExternalLink>
          {" · "}
          <ExternalLink href={text.links.releasesUrl}>
            {text.links.releases}
          </ExternalLink>
        </p>
      </div>

      <div class="perm-card">
        <h2 class="silk">{text.permissions.heading}</h2>
        <ul class="perm-list">
          {text.permissions.items.map((item) => (
            <li key={item.name} class="perm-row">
              <p class="perm-head">
                <span class="perm-title">{item.title}</span>
                <span class="perm-id mono">{item.name}</span>
              </p>
              <p class="perm-reason">{item.reason}</p>
              <ul class="perm-details">
                {item.details.map((detail) => (
                  <li key={detail} class="perm-detail">
                    {detail}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
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
