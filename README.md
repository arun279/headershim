# HeaderShim

HeaderShim is a free, MIT-licensed Chrome extension that modifies HTTP request and response headers using scoped rules and switchable profiles.

## Install

Build the extension and load it unpacked:

```sh
pnpm install
pnpm build
```

Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked", and select `.output/chrome-mv3`. The manifest requires Chrome 120 or later.

## Privacy

HeaderShim keeps your rules, profiles, and settings in Chrome's local extension storage, in this browser on this device, and opens no connection of its own. See [PRIVACY.md](PRIVACY.md).

## Permissions

The manifest declares `declarativeNetRequestWithHostAccess`, `storage`, and `activeTab`. Opening the popup gives HeaderShim temporary `activeTab` access to that tab. Persistent host access is optional and requested at runtime for the sites a rule's scope needs. The manifest allows HeaderShim to request up to `*://*/*`; that pattern covers HTTP and HTTPS sites, not `ws://` or `wss://`. The About page inside the extension explains each permission.

## Development

```sh
pnpm install
pnpm dev
pnpm build
pnpm verify
```

`pnpm install` configures git hooks: staged files are checked with Biome on commit, and the full verification gate runs before every push. `pnpm verify` runs the same gate on demand.

## License

MIT. See [LICENSE](LICENSE).
