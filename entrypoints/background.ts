export default defineBackground(() => {
  browser.commands.onCommand.addListener(() => undefined);
  browser.runtime.onInstalled.addListener(() => undefined);
});
