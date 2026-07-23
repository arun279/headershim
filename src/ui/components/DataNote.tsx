import { copy } from "../copy";
import "./DataNote.css";

/**
 * The standing disclosure of where a typed header value comes to rest and what
 * turning a rule on sends out. It stands under every surface that shows or takes
 * one: the popup readout, the popup editor, and the options rule editor. On an
 * editor it goes inside the sheet, because that sheet is aria-modal and tells
 * assistive technology to ignore everything outside it. Last within its surface
 * also keeps a toast next to the control it confirms. The long form is the About
 * page.
 */
export function DataNote() {
  return <p class="datanote">{copy.readout.dataNote}</p>;
}
