# Binder for Gemini

A Chrome extension that adds folders to the Google Gemini sidebar, so research
chats stop piling up in one long list.

Not affiliated with or endorsed by Google. Gemini is a trademark of Google LLC.

- **Folders and subfolders** in Gemini's sidebar, styled to match it (light and dark).
- **Drag chats** from Gemini's list into a folder, or between folders.
- **Filed chats are hidden** from Gemini's list, so it only shows what's left to sort.
  (Turn this off under **⋯ → Hide filed chats from the list**.)
- **File the open chat** with the folder button next to "Folders".
- **Search** across folder names and filed chat titles.
- **Colors, rename, reorder** (drag a folder above, below, or onto another).
- **Delete chats in bulk**: tick chats in Gemini's list or in your folders, then
  delete them all from Gemini in one go. This is permanent.
- **Backup**: export to a JSON file, restore from it.
- Clicking a filed chat switches to it without reloading the page.
- Titles stay in sync when you rename a chat in Gemini.

Your data stays in your browser (`chrome.storage.local`). The extension only
runs on `gemini.google.com`, asks for no permission except `storage`, and
makes no network requests.

## Install (from source)

```sh
bun install
bun run build
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose `.output/chrome-mv3`.
3. Reload gemini.google.com. A **Folders** section appears above your chat list.

After changing code, run `bun run build` again and click the reload icon on
the extension's card.

Firefox: `bun run build:firefox` and load `.output/firefox-mv2` from
`about:debugging`.

## Using it

| To do this | Do this |
| --- | --- |
| New folder | **+** button next to "Folders" |
| Subfolder, rename, color, delete | Hover a folder → **⋯** |
| File a chat | Drag it from Gemini's list onto a folder |
| File the chat you're reading | Folder-arrow button next to "Folders" |
| Move a chat | Drag it to another folder |
| Take a chat out of a folder | Hover it → **×** |
| Nest or reorder folders | Drag onto a folder (nest), or its top/bottom edge (reorder) |
| Move a folder to the top level | Drag it onto the "Folders" header |
| Rename quickly | Double-click a folder, or select it and press F2 |
| Open in a new tab | Cmd/Ctrl-click a chat |
| Delete chats from Gemini | **⋯ → Delete chats…**, tick chats, then **Delete…** |
| Delete a folder's chats | Hover the folder → **⋯ → Delete chats in this folder…** |
| Select a range of chats | While deleting, shift-click in Gemini's list |

Deleting a folder never deletes chats from Gemini; they just go back to the list.

**Deleting chats** removes them from your Gemini history for good; there's no undo,
and a Binder backup does not keep the conversations. The extension does it the
way you would: it opens each chat's ⋯ menu in Gemini's sidebar, picks Delete,
and confirms. A chat counts as deleted only once it disappears from Gemini's
list. Keep the tab open until it finishes; **Stop** halts it between chats.
Chats that fail stay selected so you can try again.

Each Google account you use in Gemini (`/u/0`, `/u/1`, …) has its own folders.

## How it works

Every Gemini chat has a permanent ID in its URL. The extension saves
**chat ID → folder** in your browser and applies it to Gemini's sidebar.

```
 ╔═══════════════════════════════════╗         ╔═══════════════════════════════╗
 ║  GEMINI SIDEBAR                   ║         ║  SAVED IN YOUR BROWSER        ║
 ╠═══════════════════════════════════╣         ╠═══════════════════════════════╣
 ║                                   ║         ║                               ║
 ║  FOLDERS               + ⋯        ║         ║  folders                      ║
 ║  ▾ ■ Research                 2   ║◄━━━━━━━━║    r1   ■ Research            ║
 ║     ▾ ■ AI papers             1   ║  draw   ║    ai1  ■ AI papers   in r1   ║
 ║           Attention notes         ║         ║                               ║
 ║       Kyoto trip                  ║         ║  chats                        ║
 ║  ─────────────────────────────    ║         ║    c055…  ──►  ai1            ║
 ║  CHATS              Gemini's own  ║━━━━━━━━►║    7f3a…  ──►  r1             ║
 ║    ░░ Attention notes ░░  hidden  ║  read   ║                               ║
 ║    ░░ Kyoto trip ░░░░░░░  hidden  ║ /app/id ║                               ║
 ║       Battery chemistry           ║         ║                               ║
 ╚═══════════════════════════════════╝         ╚═══════════════════════════════╝
```

**The mapping**

```
 ┌─────────────────────────┐      ┌─────────────────────┐      ┌───────────────┐
 │ /app/c055edd4469c9470   │ ───► │ chats["c055…"]      │ ───► │ ■ AI papers   │
 │                         │      │   folderId: "ai1"   │      │   in Research │
 └─────────────────────────┘      └─────────────────────┘      └───────────────┘
        chat URL                       saved mapping                folder
```

**What happens when**

```
  YOU                                  THE EXTENSION
  ───────────────────────────────      ──────────────────────────────────────────────
  drag a chat onto a folder      ──►   saves  chat ID → folder ID
  scroll, or Gemini updates      ──►   matches IDs · hides filed chats · syncs titles
  click a chat in a folder       ──►   clicks Gemini's own link · opens instantly
```

## Development

```sh
bun run dev        # opens a fresh Chrome with the extension, reloads on save
bun test           # 80 tests: data model, page parsing, full UI on a fake Gemini page
bun run typecheck
bun run check      # typecheck + tests + build
bun run icons      # regenerate public/icon/*.png
```

`bun run dev` uses a new browser profile, so you'll need to sign in to Google
there. Loading the build into your normal Chrome is usually easier.

### Layout

```
src/
  entrypoints/content.ts  WXT content script: storage setup, starts the app
  app.ts                  controller: watches Gemini's page, saves, re-renders
  core/model.ts           folder data and every operation on it (pure functions)
  core/gemini-dom.ts      every assumption about Gemini's HTML lives here
  core/store.ts           storage interface (chrome.storage or in-memory)
  ui/panel.ts             the folder tree, menus, drag and drop
  ui/styles.ts            CSS (inside a shadow root, isolated from Gemini)
  dev/harness.ts          run the app on a live Gemini tab without installing
tests/                    bun test + happy-dom
```

### When Gemini changes its layout

Google changes Gemini's markup without notice. If the Folders section
disappears or chats stop hiding, update the selectors in
`src/core/gemini-dom.ts` and the fake page in `tests/fixture.ts`. The
extension finds chats by their link (`/app/<id>`), not by Google's
generated class names, so small redesigns usually don't break it.
