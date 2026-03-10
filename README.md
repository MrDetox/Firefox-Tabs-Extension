# Better Tab Groups

This WebExtension enhances Firefox tab groups with powerful automation features. It automatically merges duplicate groups, suggests smart grouping by domain, and lets you create rules to organize tabs automatically.

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

## Settings

Version 2.0.0 adds customizable settings. To access them:

**Quick access**: Click the extension icon in the toolbar to open the settings popup directly below the icon.

**Alternative methods**:
1. Right-click the extension icon in the toolbar and select **Manage Extension** (or go to `about:addons`).
2. Click the **Preferences** button (or the gear icon) to open the full settings page in a new tab.

**Note**: If you don't see the extension icon, right-click the toolbar and select **Customize Toolbar**, then drag the extension icon to your preferred location.

Available settings:

- **Enable automatic group merging**: Toggle the extension on or off. When disabled, duplicate groups will not be merged.
- **Debounce time**: Adjust how long the extension waits (in milliseconds) after you finish typing a group name before checking for duplicates. Default is 1200ms. Higher values give you more time to type longer names without triggering merges.

Settings are saved automatically and sync across your Firefox devices if you have sync enabled.

## Group by Domain

The popup includes a "Group by Domain" section that analyzes your open tabs and suggests grouping tabs from the same website together.

**How it works**:
1. Click the extension icon to open the popup.
2. The extension scans all open tabs and identifies domains (e.g. `youtube.com`, `facebook.com`) with ungrouped tabs.
3. Each suggestion shows the domain name and tab count.
4. Click **Group** to create a new tab group, or **Add to "GroupName"** if a matching group already exists.

**Smart matching**: The extension checks for existing groups with similar names (case-insensitive). For example, if you have a group named "YouTube", "youtube", or "youtube.com", new YouTube tabs will be added to that group instead of creating a duplicate.

**Example**: If you have 4 YouTube tabs, 3 Reddit tabs, and several one-off tabs, the extension suggests grouping YouTube and Reddit. If you already have a "YouTube" group, the button will say "Add to YouTube" instead of "Group".

**Note**: Only ungrouped tabs appear in suggestions. Domains need 2+ ungrouped tabs to show up, unless there's already a matching group (then even 1 tab can be added).

## Auto-Group Rules

You can set up rules to automatically group tabs from specific domains. For example, automatically send all YouTube tabs to a "YouTube" group.

**How to create a rule**:
1. Click the extension icon to open the popup.
2. In the "Auto-Group Rules" section, enter a domain pattern (e.g. `youtube` or `github.com`) and a group name.
3. Click **Add Rule**.
   
**How rules work**:
- When you open a new tab or navigate to a URL, the extension checks if it matches any rule.
- If a match is found, the tab is automatically moved to the specified group.
- If the group doesn't exist, it's created automatically.
- Rules are matched case-insensitively and support partial matches (e.g. `youtube` matches `youtube.com`).
- Only the first matching rule is applied.
- You can toggle rules on/off or delete them from the popup.

**Example rules**:
| Pattern | Group Name | Effect |
|---------|------------|--------|
| `youtube` | YouTube | All youtube.com tabs → "YouTube" group |
| `github` | Dev | All github.com tabs → "Dev" group |
| `docs.google` | Docs | All Google Docs tabs → "Docs" group |

## Usage notes

- Works alongside the native tab grouping UI—just create or rename groups as usual.
- Names are de-duplicated per window. If you intentionally reuse a name in a different window, the tab will stay there.
- Only groups that already contain tabs are considered the "source of truth"; empty duplicates are ignored.
- Check the Browser Console (`Ctrl+Shift+J`) for diagnostic logs prefixed with `[BetterTabGroups]` if you need to troubleshoot.

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

For self-hosted signing, add your own `browser_specific_settings.gecko.id` (e.g. `better-tab-groups@yourdomain.com`) before running `web-ext sign`.

