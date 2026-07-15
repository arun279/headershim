import type { ComponentChildren } from "preact";
import { browser } from "wxt/browser";
import { sentence } from "../../../src/ui/components/sentence";
import { copy } from "../../../src/ui/copy";
import "./About.css";

const text = copy.options.about;

/** A compact identity card with the build, product description, and links. */
export function AboutPage() {
  return (
    <section class="page about-page" aria-labelledby="about-title">
      <div class="about-card">
        <h1 class="about-build" id="about-title" tabIndex={-1}>
          {sentence(
            text.build(browser.runtime.getManifest().version, __COMMIT__),
          )}
        </h1>
        <div class="about-description">
          {text.description.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <p>{text.license}</p>

        <p class="about-links">
          <ExternalLink href={text.links.repositoryUrl}>
            {text.links.repository}
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
