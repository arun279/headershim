# HeaderShim

HeaderShim is a free, MIT-licensed Chrome extension that modifies HTTP request and response headers using scoped rules and switchable profiles.

## Install

Build the extension and load it unpacked:

```sh
pnpm install
pnpm build
```

Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked", and select `.output/chrome-mv3`.

## Development

```sh
pnpm install
pnpm dev
pnpm build
pnpm verify
```

`pnpm install` configures git hooks: staged files are linted on commit, and the full verification gate runs before every push. `pnpm verify` runs the same gate on demand.

## License

MIT. See [LICENSE](LICENSE).
