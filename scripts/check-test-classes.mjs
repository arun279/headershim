import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Keeps test selectors tied to classes the product can render, so a renamed or
// deleted class turns its assertions red instead of leaving them quietly
// matching nothing forever. Every class token in a direct string argument to
// locator(), querySelector(), querySelectorAll(), closest(), or matches() must
// appear in a class attribute the product ships or in a stylesheet rule.
// Stylesheets count because a class the product only ever interpolates still
// has to be styled somewhere; the price is that a class survives here until its
// rule is deleted too, so this catches the renamed and the never-existed, not
// the merely orphaned.

const root = path.resolve(import.meta.dirname, "..");
const PRODUCT_ROOTS = ["src/", "entrypoints/"];

// Selector-side noise: a dot inside an attribute value or a quoted pseudo-class
// argument is not a class. `[title="api.example.com"]` and
// `:has-text("api.example.com")` would otherwise both be read as a selector for
// the classes `.example` and `.com`.
const ATTRIBUTE_SELECTOR = /\[[^\]]*\]/gu;
const QUOTED_ARGUMENT = /"[^"]*"|'[^']*'/gu;
const CLASS_TOKEN = /\.(-?[_a-zA-Z]+[\w-]*)/gu;
const SELECTOR_CALL =
  /\b(?:locator|querySelector|querySelectorAll|closest|matches)(?:<[^<>]+>)?\s*\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/gu;

// Product-side sources of a class name: a plain attribute, a string inside a
// class expression, and a class template. Templates carry interpolations, which
// are resolved below rather than dropped.
const CLASS_ATTRIBUTE = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
const CLASS_EXPRESSION = /\bclass(?:Name)?\s*=\s*\{([\s\S]*?)\}/gu;
const CLASS_TEMPLATE = /\bclass(?:Name)?\s*=\s*\{`([\s\S]*?)`\s*\}/gu;
const STRING_LITERAL = /"([^"]*)"|'([^']*)'/gu;
const INTERPOLATION = /\$\{([^}]*)\}/gu;
// A comment or a url() target holds dots that are not class names.
const CSS_NOISE = /\/\*[\s\S]*?\*\/|url\([^)]*\)/gu;

// A dotted reference standing alone in an interpolation, so the values it can
// take are readable from its declared type. Anything else is not resolved.
const REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u;
const CLASS_SHAPED = /^-?[_a-zA-Z]+[\w-]*$/u;
// Where an interpolation sat, numbered so each slot keeps its identity while
// the template is expanded. Braces are not part of any class name here.
const SLOT_MARKER = /\{(\d+)\}/u;

function isProductSource(file) {
  return (
    PRODUCT_ROOTS.some((directory) => file.startsWith(directory)) &&
    (file.endsWith(".css") ||
      file.endsWith(".html") ||
      (file.endsWith(".tsx") && !file.endsWith(".test.tsx")))
  );
}

function isTestSource(file) {
  return /\.test\.tsx?$/u.test(file) || /^e2e\/.+\.tsx?$/u.test(file);
}

function addClassTokens(text, classes) {
  for (const token of text.split(/\s+/u)) {
    if (CLASS_SHAPED.test(token)) {
      classes.add(token);
    }
  }
}

// The literal members of a string union declared for this name in this file,
// such as `variant: "domain" | "grant"`.
function unionValues(name, source) {
  const declaration = new RegExp(
    `\\b${name}\\??\\s*:\\s*((?:"[^"]*"\\s*\\|\\s*)+"[^"]*")`,
    "u",
  ).exec(source);
  return declaration === null
    ? []
    : [...declaration[1].matchAll(/"([^"]*)"/gu)].map((match) => match[1]);
}

// Every concrete class string a template can build. A slot whose values cannot
// be read contributes the empty string, which is what the common
// `${flag ? " extra" : ""}` shape yields anyway; the class its other branch adds
// is picked up from the literal instead.
function templateProducts(marked, expressions, source) {
  const parts = marked.split(SLOT_MARKER);
  let products = [parts[0] ?? ""];
  for (let index = 1; index < parts.length; index += 2) {
    const reference = (expressions[Number(parts[index])] ?? "").trim();
    const values = REFERENCE.test(reference)
      ? unionValues(reference.split(".").at(-1), source)
      : [];
    const tail = parts[index + 1] ?? "";
    products = products.flatMap((product) =>
      (values.length === 0 ? [""] : values).map(
        (value) => `${product}${value}${tail}`,
      ),
    );
  }
  return products;
}

function addTemplateClasses(template, source, classes) {
  const expressions = [];
  const marked = template.replace(INTERPOLATION, (_, expression) => {
    expressions.push(expression);
    return `{${expressions.length - 1}}`;
  });
  for (const product of templateProducts(marked, expressions, source)) {
    addClassTokens(product, classes);
  }
  for (const expression of expressions) {
    for (const literal of expression.matchAll(STRING_LITERAL)) {
      addClassTokens(literal[1] ?? literal[2] ?? "", classes);
    }
  }
}

function productClasses(files) {
  const classes = new Set();
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    if (file.endsWith(".css")) {
      for (const match of source.replace(CSS_NOISE, "").matchAll(CLASS_TOKEN)) {
        classes.add(match[1]);
      }
      continue;
    }
    for (const match of source.matchAll(CLASS_ATTRIBUTE)) {
      addClassTokens(match[1] ?? match[2] ?? "", classes);
    }
    for (const match of source.matchAll(CLASS_EXPRESSION)) {
      for (const literal of (match[1] ?? "").matchAll(STRING_LITERAL)) {
        addClassTokens(literal[1] ?? literal[2] ?? "", classes);
      }
    }
    for (const match of source.matchAll(CLASS_TEMPLATE)) {
      addTemplateClasses(match[1] ?? "", source, classes);
    }
  }
  return classes;
}

const tracked = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => file.length > 0 && existsSync(path.join(root, file)));

const classes = productClasses(tracked.filter(isProductSource));
const violations = [];
for (const file of tracked.filter(isTestSource)) {
  const source = readFileSync(path.join(root, file), "utf8");
  for (const call of source.matchAll(SELECTOR_CALL)) {
    const selector = (call[1] ?? call[2] ?? call[3] ?? "")
      .replace(INTERPOLATION, "")
      .replace(ATTRIBUTE_SELECTOR, "")
      .replace(QUOTED_ARGUMENT, "");
    for (const match of selector.matchAll(CLASS_TOKEN)) {
      if (!classes.has(match[1])) {
        const line = source.slice(0, call.index).split("\n").length;
        violations.push(`${file}:${line}: .${match[1]}`);
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} test class selector violation(s): each class must appear in a shipped class attribute or stylesheet.`,
  );
  process.exit(1);
}

console.log("Test class selector check passed.");
