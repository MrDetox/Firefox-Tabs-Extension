# Changelog - Better Tab Groups

## [3.7.3] - 2026-07-17

### Fixed
- **Cleanup ignored "Single Tab Limit" rules in some cases:** The cleanup and Deep clean could report "No duplicates found" even when a limited domain (e.g. facebook.com) had several tabs open on different pages. The domain rules are now always loaded before a sweep runs, so they are applied reliably.
- **Domain rules now cover subdomains:** A "Single Tab Limit" rule for `facebook.com` now also matches `www.facebook.com`, `m.facebook.com`, and other subdomains, so all tabs on that site collapse to one.

## [3.7.2] - 2026-07-17

### Added
- **"Deep clean" button:** Old tabs that were unloaded from memory hide their address, so the normal cleanup cannot see them at all. Deep clean briefly reloads each such tab to read its address, then closes every duplicate found. Manual-only (it uses some data and can take a moment), never runs automatically.

## [3.7.1] - 2026-07-17

### Fixed
- **Cleanup sweep now honors "Single Tab Limit" domain rules:** The auto-close sweep and the "Clean up duplicates now" button previously only closed tabs with the exact same URL, so a domain limited to a single tab (e.g. facebook.com) could still have several tabs open on different pages and the sweep reported "No duplicates found". The sweep now also collapses all tabs on a limited domain down to one, keeping the most recently used loaded tab.

## [3.7.0] - 2026-07-17

### Added
- **Auto-close existing duplicate tabs (Firefox for Android):** New option that closes duplicate tabs which are already open, keeping the most recently used one. Runs on startup by default, with an optional sub-setting to also sweep every few minutes, or it can be turned off entirely.
- **"Clean up duplicates now" button:** Removes duplicate tabs on demand with one tap. Available on all platforms.

### Fixed
- **Stale duplicate tabs not closing on Firefox for Android:** Fixed duplicates going undetected once a tab had been unloaded from memory. Android unloads ("zombifies") background tabs and strips their URL from the extension API, so a stale duplicate was invisible until manually reopened and reloaded. The extension now remembers each tab's last known URL so unloaded duplicates are still found, and it reconciles a stale tab the moment it is reopened, no manual reload needed.

## [3.6.4] - 2026-06-09

### Added
- **"Use Current Tab" Buttons:** Added convenient "Use Current Tab" buttons to the Single Tab Limit (Domain Rules) and Site-Specific Page Deduplication (Path Rules) sections to quickly capture and populate the active tab's domain.

### Fixed
- **Protocol-Agnostic Domain matching:** Fixed a bug where entering raw domains (e.g., `youtube.com`) or extension UUIDs (e.g., `a88185fd-088d-4cc6-bf20-101eddf91850`) without a protocol could not be resolved as valid domains.
- **Dynamic Protocol Queries:** Fixed a bug where tab deduplication failed for non-HTTP/HTTPS protocol schemes (such as `moz-extension://` overlays) by dynamically querying tabs matching the tab's specific protocol scheme.
- **Restored Desktop Grouping Handler:** Restored the missing `useCurrentTabForGrouping` function in the Auto-Group Rules section to prevent ReferenceErrors on desktop.

## [3.6.3] - 2026-06-09

### Changed
- **Redesigned Custom Rules UI**: Split the single rules form into three separate, user-friendly sections: Single Tab Limits (Domain), Specific Page Deduplication (Exact), and Site-Specific Page Deduplication (Path).
- **Explanatory Guidelines**: Added one-sentence descriptions and concrete placeholder examples for each rule type to make their behaviors clear at a glance.
- **Dynamic Disabling**: The Site-Specific Page Deduplication (Path) section is now automatically grayed out and disabled when the global "Merge duplicate URLs" setting is active, as it is already handled.

## [3.6.2] - 2026-06-09

### Fixed
- Fixed a bug where other extensions' pages (e.g. password manager overlays) were blocked from duplicate tab prevention; now only our own settings/popup pages are excluded.
- Fixed a bug on Android where tapping the extension line closed the menu without opening settings; implemented a robust focusing/creation flow for the settings tab.
- Configured the mobile options UI to expand the "Merge duplicate tabs" section by default for better visibility.

## [3.6.1] - 2026-06-09

### Fixed
- Fixed manifest validation warnings by increasing `strict_min_version` to Firefox 140 (Desktop) and Firefox for Android 142 to support the `data_collection_permissions` key properly.

## [3.6.0] - 2026-06-09

### Added
- **Mobile Compatibility (Firefox for Android)**: Enabled running the extension on Firefox for Android devices.
- **Dynamic Mobile/Options UI**: The settings page now automatically scales responsively to fit mobile and full tab width, while keeping the classic narrow popup style on desktop.
- **Auto-Hiding Unsupported Mobile Features**: Automatically hides desktop-only tab grouping features on mobile layouts.
- **Mobile Click Redirect**: Clicking the extension icon on mobile automatically opens the options page in a new settings tab.

### Fixed
- Fixed a background script crash on startup for devices without `tabGroups` API support (e.g. mobile).
- Fixed a bug where tab deduplication failed on mobile due to unsupported `windows.update` API calls.

## [3.5.0] - 2026-03-10

### Added
- **Quick Group Renaming**: New inline editing feature for suggested groups! Customize the group name right from the button before creating it.
- **Smart TLD Stripping**: Group suggestions now automatically strip common extensions (e.g. .com, .ai, .org) for a cleaner grouping experience.
- **Improved Feedback Tab**: The feedback section is now open by default and contains updated messaging to help users share their thoughts.

### Changed
- **Refined Quick Group UI**: Unified "Group" and "Edit" buttons into a single cohesive element with a toggle-based editor. 
- **Persisted Context**: The "Add to" prefix remains visible during editing to provide better context.

### Fixed
- Fixed a bug where quotation marks remained visible during the inline editing process.
- Performance and logic fixes for the Quick Group suggestion engine.
