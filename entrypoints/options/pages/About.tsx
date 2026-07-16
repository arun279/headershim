import type { ComponentChildren } from "preact";
import { browser } from "wxt/browser";
import { sentence } from "../../../src/ui/components/sentence";
import { copy } from "../../../src/ui/copy";
import "./About.css";

const text = copy.options.about;

/** A compact identity card with the build, product description, and links. */
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
