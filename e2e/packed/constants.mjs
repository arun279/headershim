// The managed policy is a static fixture, so the update server it points at
// binds a fixed port rather than an ephemeral one. 127.0.0.1 (not "localhost")
// keeps Chrome and the server on the same address instead of racing IPv4/IPv6.
export const updateHost = "127.0.0.1";
export const updatePort = 8730;
export const updatesUrl = `http://${updateHost}:${updatePort}/updates.xml`;
export const crxUrl = `http://${updateHost}:${updatePort}/headershim.crx`;

// Google Chrome reads machine policies from here on Linux; Chromium and other
// channels use different paths, which is why the gate pins channel:'chrome'.
export const managedPolicyDir = "/etc/opt/chrome/policies/managed";
export const managedPolicyFile = "headershim.json";
