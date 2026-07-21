/** Handles the editor-wide commit chord and keeps popup shortcuts off buttons. */
export function handleEditorCommitKey(
  event: KeyboardEvent,
  onCommit: () => void,
): boolean {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    onCommit();
    return true;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.tagName === "BUTTON" && /^[a-zA-Z0-9]$/.test(event.key)) {
    event.preventDefault();
  }
  return false;
}
