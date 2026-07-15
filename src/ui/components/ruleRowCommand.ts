import type { RefObject } from "preact";
import {
  type RowCommand,
  rowCommand,
} from "../../../entrypoints/popup/keyboard";

type RowAction = Exclude<RowCommand, "menu">;

type RowCommandActions = {
  [Command in RowAction]?: (() => void) | undefined;
};

function registerRuleRow(
  rows: RefObject<Map<string, HTMLLIElement>>,
  ruleId: string,
  element: HTMLLIElement | null,
): void {
  if (element === null) {
    rows.current?.delete(ruleId);
  } else {
    rows.current?.set(ruleId, element);
  }
}

/** Supplies the one-tab-stop focus wiring shared by every rule list. */
export function rovingRuleRowProps(
  rows: RefObject<Map<string, HTMLLIElement>>,
  ruleId: string,
  current: boolean,
  onFocus: (ruleId: string) => void,
) {
  return {
    tabIndex: current ? 0 : -1,
    onFocus: () => onFocus(ruleId),
    rowRef: (element: HTMLLIElement | null) =>
      registerRuleRow(rows, ruleId, element),
  };
}

/** Dispatches the shared focused-row keyboard grammar for every rule list. */
export function dispatchRowCommand(
  event: KeyboardEvent,
  openMenu: () => void,
  actions: RowCommandActions,
): void {
  const command = rowCommand(event);
  if (command === undefined) {
    return;
  }
  event.preventDefault();
  if (command === "menu") {
    openMenu();
  } else {
    actions[command]?.();
  }
}
