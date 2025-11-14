# Tab Group Deduper

This WebExtension keeps your Firefox tab groups unique by name. When you try to put a tab into a group that already exists (and already contains tabs), the extension automatically moves the new tab into the existing group instead of creating a duplicate.

## How it works

- Watches for new tab groups or group rename events through the `tabGroups` API.
- When a group is created or renamed, it looks for another group in the same window with the identical title that already has tabs.
- If it finds a match, the extension moves the new group's tabs into the existing group and lets Firefox remove the now-empty duplicate group automatically.
- Waits a moment after you finish typing the name (press Enter) before merging, so partial titles like `test` do not immediately collide with `testing`.
- Retries briefly when Firefox reports the new group before its tabs are attached, ensuring the merge still happens.

## Installation (temporary test build)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Choose the `manifest.json` file from this project.
4. The extension will now run until you restart Firefox.

## Usage notes

- Works alongside the native tab grouping UI—just create or rename groups as usual.
- Names are de-duplicated per window. If you intentionally reuse a name in a different window, the tab will stay there.
- Only groups that already contain tabs are considered the "source of truth"; empty duplicates are ignored.
- Check the Browser Console (`Ctrl+Shift+J`) for diagnostic logs prefixed with `[TabGroupDeduper]` if you need to troubleshoot.

## Development

- Requires Firefox 139 or newer for the `tabGroups` API.
- Background script lives in `background.js`.
- Update `manifest.json` as needed (e.g. version bumps, icons, localization).

## Publishing to addons.mozilla.org (AMO)

1. Prepare assets:
   - Supply at least a 128×128 PNG icon and list it under the `icons` field in `manifest.json`.
   - Gather screenshots (1280×800 or larger) to showcase the extension.
2. Bump the `version` in `manifest.json` whenever you upload a new package.
3. Install `web-ext` (`npm install -g web-ext`) and run `web-ext lint` to catch validation issues locally.
4. Create a distributable archive with `web-ext build` (output lives in `web-ext-artifacts/`).
5. Confirm `browser_specific_settings.gecko.data_collection_permissions.required` reflects your data practices (set to `["none"]` if you do not collect data).
6. Visit [addons.mozilla.org/developers](https://addons.mozilla.org/developers/), start a new submission, and upload the generated `.zip`.
7. During submission, provide a unique name, description (you can adapt this README), and privacy policy if required.
8. Wait for AMO review. Once approved, Firefox users can install the published version directly from AMO.

For self-hosted signing, add your own `browser_specific_settings.gecko.id` (e.g. `tab-group-deduper@yourdomain.com`) before running `web-ext sign`.

