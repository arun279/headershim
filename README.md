# headershim

headershim is a free, MIT-licensed Chrome extension that modifies HTTP request and response headers using scoped rules and switchable profiles.

## Development

```sh
pnpm install
pnpm dev
pnpm build
pnpm check
```

`pnpm install` configures git hooks: staged files are linted on commit, and the full check suite runs before every push. `pnpm check` runs the same suite on demand.
