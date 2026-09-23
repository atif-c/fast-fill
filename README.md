# fast-fill

Fast text expander userscript. Type a trigger word, press `Ctrl + Shift + Space` to expand it.

Works in textareas, inputs, contenteditables, and Monaco editors.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) (open source).
2. Create a new userscript and paste in `dist/fast-fill.js`.
3. Save. Runs on all pages (`*://*/*`).

## Usage

Define triggers in `DEFAULT_PLACEHOLDERS`:

```ts
const DEFAULT_PLACEHOLDERS = {
  ser: 'search "{{_}}"',
}
```

- Type `ser`, press `Ctrl + Shift + Space` → `search "<clipboard>"`
- `{{_}}` is replaced with clipboard text on single press.
- Press twice quickly (within 350ms) to expand empty: `{{_}}` is deleted and cursor parks where the first one was.
- `\{{_}}` inserts a literal `{{_}}` without reading clipboard.
- Trigger keys must be `\w+` (letters/digits/underscore).

## Build

```bash
pnpm install
pnpm build  # tsc -> dist/
pnpm check
```

## License

Unlicense
