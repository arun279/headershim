# HeaderShim

HeaderShim is a free, MIT-licensed Chrome extension that modifies HTTP request and response headers using scoped rules and switchable profiles.

## Install

Install it from the Chrome Web Store: https://chromewebstore.google.com/detail/headershim/ecejnncfklopghicmcigpmdfogblpigd

Or build the extension and load it unpacked:

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
pnpm zip
pnpm verify
```

`pnpm install` configures git hooks: staged files are checked with Biome on commit, and the full verification gate runs before every push that sends a non-deletion ref. `pnpm verify` runs the same gate on demand.

`pnpm zip` builds the release archive and checks that it exactly matches `.output/chrome-mv3` with no source maps.

`pnpm size:record` lowers size limits to the current bounded slack grain after intentional size reductions.

`store/` holds the Chrome Web Store listing images: the four 1280x800 screenshots and the two promo tiles. The tiles render from `store/tiles/*.html` at 440x280 and 1400x560 with a device scale factor of 1; retake the screenshots and re-render the tiles whenever the surfaces they show change.

The Playwright project gate compares the working tree with committed `HEAD` and the default-branch merge base. The pre-push hook and pull-request CI also compare the prior remote revision through `PLAYWRIGHT_PREVIOUS_REFS`. A deliberate removal needs one `{ "base", "test", "reason" }` acknowledgement for each reported comparison commit that contained the test. Acknowledgements become inactive when their comparison commit is no longer used.

## License

MIT. See [LICENSE](LICENSE).
