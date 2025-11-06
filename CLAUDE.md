# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Application Title
- **Application Name**: memo3
- **Window Title**: memo3

## Commands

### Running the Application
- `npm start` - Launch the Electron app in production mode
- `npm run dev` - Launch the Electron app in development mode

### Building the Application
- `npm run build` - Build macOS Universal Binary (Intel + Apple Silicon)
- `npm run build-all` - Build for all platforms (macOS arm64, macOS x64, Windows x64)
- Build output is in `dist/` directory

### Development
- No linting or test commands are currently configured
- The application uses Electron 37.4.0, ACE editor 1.43.2, and chokidar 4.0.3
- Auto-save, smart tab management, and session restoration provide VSCode-like editing experience

## Architecture

### Application Structure
This is an Electron-based memo application with ACE editor integration for markdown editing. The app supports VSCode-like multi-tab editing with file-system based management, enhanced search capabilities, and session restoration.

**Main Process (main.js)**
- Manages application lifecycle and window creation with standard title bar
- Handles IPC communication with renderer process
- Manages file-system based data persistence with chokidar file watching
- Filters out temporary files (backup ~, swap .swp, hidden ., .DS_Store, .tmp)
- Implements macOS-specific error handling for IMK (Input Method Kit) issues
- Data is stored in:
  - User-selected root folder - All .md/.txt files (sorted by modification time, descending)
  - `workspace.json` - Multi-workspace configuration (version 2.0 format: workspaces list, active workspace)
  - `settings.json` - Editor configuration (keybindings, themes, font size, whitespace display)
  - `sessions.json` - Per-workspace session states (open tabs, active tab per workspace)
  - `tags.json` - Tag definitions and file associations (event-sourced log format for multi-PC sync)

**Renderer Process**
- `index.html` - Main UI with minimal sidebar, draggable tab bar, editor workspace, and dual context menus
- `renderer.js` - Handles smart tab management, drag-and-drop reordering, content-based file creation, and theme integration
- `styles.css` - Dynamic theming system with CSS variables, supports 7+ ACE editor themes
- `preview.html` - Preview window UI with markdown rendering and controls
- `preview-renderer.js` - Markdown to HTML conversion and preview window functionality

**Security**
- `preload.js` - Provides secure bridge between main and renderer processes using contextBridge
- Context isolation is enabled, node integration is disabled

### Key Features
- **Multiple Workspace Support**: Manage multiple project folders with independent sessions, quick switching, and auto-restore
- **File-System Management**: Select root folder, auto-scan .md/.txt files, real-time file watching, filters temporary files
- **Multi-Tab Interface**: Open multiple files in tabs with drag-and-drop tab reordering
- **Per-Workspace Session Restoration**: Each workspace maintains its own session (open tabs, active tab, editor states)
- **Tag Management**: Organize files with color-coded tags, filter by tags, search tags, multi-PC sync support
- **Enhanced Search**: Search both filenames and file content with detailed results display, combinable with tag filters
- **Editor Controls**: Font size adjustment, whitespace character display, theme toggle, markdown preview, developer tools access
- **Theme Toggle**: Quick switching between two user-configured themes via 🎨 button
- **Auto-Save**: Automatic save 5 seconds after editing, prevents saving unchanged files
- **Smart New File Creation**: + button creates files when 2+ non-empty lines exist, auto-generates filenames from content
- **File List Display**: Shows title (first non-empty line), filename, full modification date/time, and color-coded icons (untagged: draft, tagged: docs with first tag's color)
- **Context Menus**: Right-click files for rename/delete/tag management, right-click status bar for developer tools
- **ACE Editor Integration**: Customizable keybindings, themes with app-wide theme matching
- **Tab Management**: Drag-and-drop reordering, smart closing, editor focus on new tab creation, scroll buttons for many tabs
- **Real-time Updates**: File changes detected automatically, file list order updates on modification
- **External Change Handling**: Auto-reload files modified by external editors, preserves cursor and scroll position
- **Material Symbols Icons**: Uses Material Symbols for consistent, scalable iconography throughout the UI
  - File icons: `draft` (untagged with default color), `docs` (tagged with first tag's color)
  - UI controls: `folder`, `search`, `preview`, `routine`, `space_bar`, `text_decrease`, `text_increase`, `settings`, `sell`
  - All icons use `var(--text-color)` for theme-consistent coloring (except file icons with tag colors)

### IPC Communication Channels
**File Management**
- `get-files` - Retrieve all files from root folder (sorted by modification time)
- `get-root-folder` - Get current root folder path
- `load-file` - Load file content
- `save-file` - Save file content (with change detection)
- `create-file` - Create new file in selected root folder
- `delete-file` - Delete file
- `rename-file` - Rename file (for title-based filename updates)
- `search-files-content` - Search filenames and file content

**Developer Tools**
- `open-dev-tools` - Open developer tools in detached window

**Settings & Session Management**
- `get-settings`, `save-settings` - Editor settings management (includes theme presets, with real-time persistence)
- `get-session`, `save-session` - Per-workspace session state management (open tabs, active tab)
- `select-folder` - Folder selection with immediate UI update (no restart required, adds to workspace list)

**Workspace Management**
- `get-workspaces` - Retrieve all workspaces with active workspace (sorted by last accessed)
- `add-workspace` - Add new workspace with folder selection dialog
- `switch-workspace` - Switch to different workspace (saves current session, loads target session)
- `remove-workspace` - Remove workspace from list (does not delete folder)

**Preview Window**
- `open-preview` - Open markdown preview in separate window
- `update-preview` - Update preview window content
- `request-preview-reload` - Request to reload preview from current active tab
- `preview-update` - Event to notify preview window of content changes
- `reload-preview-content` - Event to request main window to send updated content

**Tag Management**
- `get-tags` - Retrieve all tags and file-tag associations
- `create-tag` - Create new tag with name, color, and order
- `update-tag` - Update tag properties (name or color)
- `delete-tag` - Delete tag and all its file associations
- `add-file-tag` - Associate tag with file
- `remove-file-tag` - Remove tag association from file
- `get-file-tags` - Get all tags associated with a specific file

**URL and External Actions**
- `open-url` - Open URLs in default browser from editor context menu
- `search-google` - Google search for selected text from editor context menu

**Legacy Support (Backwards Compatibility)**
- `get-memos`, `save-memo`, `delete-memo`, `search-memos` - Legacy memo operations

**Events**
- `files-updated` - Notifies renderer when files change

### Advanced Features

**Smart New File Creation**
- **Content-Based Triggering**: Files are created only when 2+ non-empty lines exist
- **Auto-Generated Filenames**: Uses first non-empty line (up to 16 chars) + .md extension
- **Duplicate Handling**: Automatically adds (2), (3), etc. for existing filenames
- **Editor Focus**: New tabs automatically focus on editor for immediate typing
- **Placeholder Text**: Shows "タイトルを入力してください" until content is entered

**Auto-Save and Change Detection**
- **Timed Auto-Save**: Automatically saves files 5 seconds after the last edit
- **IME-Safe Auto-Save**: Detects IME composition state (Japanese input) and defers auto-save until conversion completes
- **Auto-Save Retry**: If IME conversion is in progress, reschedules auto-save to prevent character loss
- **Change Detection**: Compares content before saving to prevent unnecessary file updates
- **Close Auto-Save**: Automatically saves modified files when closing tabs
- **Smart Closing**: Auto-closes unused tabs when opening new files from file list
- **File List Updates**: Automatically updates file order when files are modified
- **Temporary File Filtering**: Ignores editor backup files (~), swap files (.swp), hidden files (.), and system files (.DS_Store, .tmp)

**Enhanced Search System**
- **Dual Search Mode**: Search both filenames and file content simultaneously
- **Results Categorization**: Separate display for filename matches vs content matches
- **Match Text Display**: Shows matched text snippets for each result
- **Line Number Display**: Show line numbers for content matches
- **Visual Indicators**: Color-coded match types (filename: green, content: white)
- **Direct Navigation**: Click search results to open files directly
- **Jump to Line**: Click content match to open file and scroll to specific line
- **Clear Function**: Easy search reset with × button
- **Tag Filter Integration**: Combine text search with tag filters for precise results

**Tag Management System**
- **Tag Creation**: Create tags with custom names and colors from 16-color palette in settings or tag dialog
- **Quick Tag Creation**: Type tag name in search box and press Enter to create instantly
- **Settings Management**: Dedicated "Tags" tab in settings dialog for creating, editing, deleting, and reordering tags
- **Drag & Drop Ordering**: Reorder tags by dragging in settings, order persists across all displays
- **File Tagging**: Right-click files to open tag dialog (sell icon button in file header), click tags to toggle assignment
- **Tag Editing**: Right-click tags in settings or tag dialog for edit/delete menu, unified dialog for name and color
- **Tag Filtering**: Three-state filter (show/hide/none) accessible via Material Symbols sell icon button
- **Filter Clear Button**: "クリア" button in tag filter header to reset all filters at once
- **Visual Indicators**: File header shows tag badges after filename, file list icons show first tag's color
- **Compact Badge Design**: Tags displayed as small, rounded badges (11px font, 6px radius) in file header
- **Consistent Order Display**: Tags appear in same order (defined in settings) across file header, tag filter, and file icon colors
- **Color Palette**: 16 predefined colors (red, pink, purple, blue, cyan, teal, green, lime, yellow, amber, orange, brown)
- **Event-Sourced Sync**: Log-based data structure enables conflict-free multi-PC synchronization
- **Search Integration**: Text search and tag filters work together seamlessly
- **Session Persistence**: Tag filter states saved per workspace session
- **Simplified Dialog**: Tag assignment dialog shows only search box, tag list, and close button for streamlined UX

**Multiple Workspace Management**
- **Workspace Selector UI**: Dropdown in sidebar showing current workspace name with add button
- **Quick Switching**: Click workspace name to open dropdown menu with all workspaces (sorted by last accessed)
- **Add Workspace**: + button opens folder selection dialog, adds workspace to list, auto-switches to new workspace
- **Remove Workspace**: Confirmation dialog → "解除" removes from list (does not delete folder)
- **Per-Workspace Sessions**: Each workspace maintains independent session (open tabs, active tab)
- **Automatic Session Save**: Saves current session before switching to different workspace
- **Automatic Session Restore**: Loads saved session when switching back to workspace
- **Unsaved New Tab Protection**: Before switching, checks for unsaved new tabs (files not yet created), prompts to save or cancel
- **Auto-Save Modified Files**: Automatically saves all modified existing files before workspace switch
- **First-Time Setup**: On initial launch, creates ~/Documents/memo3 with welcome files (概要.md, 操作説明.md, サンプル.md)
- **Migration Support**: Automatically migrates old workspace.json and session.json formats to new multi-workspace format

**Session Restoration**
- **Per-Workspace State Persistence**: Saves all open tabs, active tab, and file states per workspace
- **Automatic Restoration**: Restores workspace-specific session on app restart without user intervention
- **File Validation**: Only restores tabs for files that still exist on disk
- **Rename Tracking**: Updates session immediately when files are renamed, ensuring correct restoration
- **Content Restoration**: Reloads file content and maintains editor state
- **Smart Recovery**: Handles missing files gracefully during restoration, restores only existing files

**Tab Management Enhancements**
- **Drag-and-Drop Reordering**: Drag tabs to reorder them with visual feedback
- **Tab Scroll Buttons**: Left (‹) and right (›) arrow buttons on either side of tab list for scrolling when many tabs are open
- **Smart Layout**: Left scroll button on left side, right scroll button on right side, prevents overflow issues
- **Smart Button States**: Scroll buttons auto-disable at edges of tab list
- **Flexbox Optimization**: Tab list properly constrained with min-width: 0 to enable horizontal scrolling
- **Dynamic Titles**: Tab titles auto-update based on file content (first non-empty line)
- **Smart Tab Creation**: + button creates new tabs with immediate editor focus
- **Visual States**: Active tabs and hover states clearly indicated

**Theme Integration**
- **Dynamic App Theming**: App colors automatically match selected ACE editor theme
- **CSS Variables**: Uses CSS custom properties for consistent theming
- **Multiple Theme Support**: Monokai, GitHub, Tomorrow, Twilight, Solarized, Dracula themes
- **Quick Theme Toggle**: 🎨 button allows instant switching between two preset themes configured in settings
- **Settings Preservation**: Theme toggle does not modify the configured theme presets in settings

**File List Improvements**
- **Three-Line Display**: Shows title, filename, and full date/time (YYYY/MM/DD HH:MM)
- **Content-Based Titles**: Uses first non-empty line as display title
- **Color-Coded Icons**: Untagged files show draft icon, tagged files show docs icon with first tag's color
- **Real-Time Sorting**: Automatically reorders by modification time when files change
- **Clean Interface**: Removed file list header and new file button for minimal design

**Context Menu System**
- **File Context Menu**: Right-click files for "ファイル名更新" (filename update) and "削除" (delete)
- **Status Bar Context Menu**: Right-click status bar for "開発者ツール" (developer tools)
- **Editor Context Menu**: Right-click in editor for URL opening, Google search, standard editing functions, and bullet list operations
- **Bullet List Operations**: Add/remove bullet points for selected lines
  - "箇条書き(-)にする": Add "- " prefix to each selected line (preserves leading whitespace)
  - "箇条書き(1)にする": Add "1. " prefix to each selected line (preserves leading whitespace)
  - "箇条書きをやめる": Remove "- ", "* ", or "1. " prefixes from selected lines
  - **Tab Key Indent**: Press Tab on bullet list line to increase indentation (adds 2 spaces)
  - **Shift+Tab Outdent**: Press Shift+Tab on bullet list line to decrease indentation (removes 2 spaces)
  - Full Undo/Redo support for all bullet operations
- **Smart Positioning**: Context menus automatically adjust position to stay within screen bounds
- **Filename Updates**: Auto-generates new filenames based on file content, preserves extensions
- **Safety Confirmations**: Confirmation dialogs before file deletion

**Advanced Editor Features**
- **URL Detection**: Automatically detects URLs in text, right-click to open in browser
- **Text Selection Search**: Select text and right-click to search on Google
- **Markdown Preview**: Separate window for live markdown preview with dark/light mode toggle
- **Preview Controls**: Theme toggle, print, zoom out, 1:1 (reset), zoom in, reload buttons in top-right corner
- **Preview Reload**: Manually refresh preview content from current active tab
- **Preview Rendering**: Complete markdown support including:
  - Headings (h1-h6) with proper hierarchy and borders
  - Bold, italic, and strikethrough (`~~text~~`)
  - Nested bullet and numbered lists with indentation
  - Code blocks with syntax preservation (no extra line breaks)
  - Inline code with background highlighting
  - Block quotes with proper consolidation
  - Tables with pipe-delimited syntax (`| Header | Header |`)
  - Horizontal rules (`---` and `****`)
  - Links and images
- **Preview Print Support**: Print preview with proper formatting, no scrollbars, word-wrap for long lines
- **Preview Independence**: Preview window shows snapshot of content, doesn't change with tab switching
- **Enhanced Search Box**: Properly positioned search interface with theme integration
- **Emacs Keybinding Support**: Full Emacs-style search navigation with ^S (next), ^R (previous), ^G (close)
- **Smart Search Focus**: Search field interactions automatically return focus to editor
- **System Clipboard Integration**: Complete clipboard synchronization with all applications
- **Multi-layer Clipboard Handling**: ACE events, DOM events, keyboard commands, and context menus
- **Cross-Platform Clipboard**: Works seamlessly on Windows, macOS, and Linux
- **Keybinding-Specific Shortcuts**: Emacs ^W/Alt+W/^Y, standard Ctrl+C/X/V support

**Behavior Examples**
1. **New File Creation**: Click + button → New tab opens with placeholder. Type "Hello" + Enter + "World" → File "Hello.md" created automatically, tab title updates to "Hello"
2. **Tab Reordering**: Drag tabs to reorder them. Visual feedback shows during drag operation
3. **File Renaming**: Right-click file → "ファイル名更新" → Filename updates based on first non-empty line
4. **Theme Switching**: Change ACE theme in settings → App colors automatically match editor theme
5. **Quick Theme Toggle**: Click 🎨 button → Instantly switches between Theme 1 and Theme 2 configured in settings
6. **Developer Tools**: Right-click status bar → "開発者ツール" → Opens in separate window
7. **Smart Positioning**: Right-click near screen edge → Context menu automatically repositions to stay visible
8. **URL Opening**: Type https://example.com → Right-click on URL → "URLを開く" → Opens in default browser
9. **Google Search**: Select "machine learning" text → Right-click → "Googleで検索" → Opens Google search in browser
10. **Emacs Search**: Set Emacs keybinding → ^S opens search → Type query → ^S next match → ^R previous → ^G close
11. **Folder Selection**: Settings → Select folder → File list updates immediately without restart
12. **Clipboard Operations**: Select text → Ctrl+C (or right-click copy) → Switch to another app → Ctrl+V works perfectly
13. **Emacs Clipboard**: Select text → ^W (cut) or Alt+W (copy) → ^Y (yank) → Text transfers to/from system clipboard
14. **Theme Configuration**: Settings → Select Theme 1 (e.g., Monokai) and Theme 2 (e.g., GitHub) → Save → Use 🎨 button to toggle between them
15. **Theme Toggle Preservation**: Click 🎨 button multiple times → Theme switches between configured presets → Settings dialog shows original Theme 1 and Theme 2 values unchanged
16. **External File Modification**: Open file in memo3 → Edit same file in external editor → Save in external editor → memo3 automatically reloads content while preserving cursor position and scroll location
17. **IME-Safe Auto-Save**: Type Japanese text "こんにちは" → Start converting → Auto-save timer triggers → Save is deferred until conversion completes → Press Enter to confirm → Auto-save executes without losing characters
18. **Bullet List Creation**: Select 3 lines of text → Right-click → "箇条書き(-)にする" → Each line gets "- " prefix → Ctrl+Z undoes all at once
19. **Indented Bullet Lists**: Select lines with leading spaces "  item1\n  item2" → Right-click → "箇条書き(-)にする" → Results in "  - item1\n  - item2" (spaces preserved)
20. **First-Time Launch**: Launch memo3 for first time → Creates ~/Documents/memo3 folder → Generates 3 welcome files (概要.md, 操作説明.md, サンプル.md) → Opens with files visible
21. **Add Workspace**: Click + button in workspace selector → Select folder dialog appears → Choose "ProjectA" folder → Workspace added and switched to ProjectA → File list shows ProjectA files
22. **Switch Workspace**: Click "ProjectA" dropdown → Shows "ProjectA" and "memo3" in list → Click "memo3" → Current tabs saved → All tabs closed → memo3 workspace loaded → Previous memo3 tabs restored
23. **Remove Workspace**: Click "ProjectA" dropdown → Hover over "ProjectA" → Click "解除" button → Confirm → ProjectA removed from list → Folder remains on disk, only removed from workspace list
24. **Workspace Session Independence**: Open file1.md and file2.md in "ProjectA" → Switch to "memo3" → Open file3.md → Switch back to "ProjectA" → file1.md and file2.md tabs restored exactly as left
25. **Unsaved New Tab Protection**: Create new tab → Type "Hello\nWorld" → Switch workspace → Dialog appears: "未保存の新規タブがあります: - Hello (2行)" → Click OK → File "Hello.md" saved automatically → Workspace switches
26. **New Tab Keyboard Shortcut**: Press ⌘N (macOS only) → New tab opens with placeholder text → Immediately ready for typing
27. **Empty State UI**: Close all tabs → Center of editor shows large "新しい文書を作成" button → Click button → New tab opens
28. **Unified Button Colors**: New tab (+) button in tab bar matches workspace add (+) button color (blue)
29. **Search with Line Jump**: Type "機能" in search box → Results show matched lines with "行 5" label → Click "行 5" → File opens and scrolls to line 5 with cursor positioned
30. **Bullet List Indentation**: Type "- Item 1" → Press Enter → Type "Item 2" → Press Tab → Line indents to "  - Item 2" → Press Shift+Tab → Line outdents back to "- Item 2"
31. **Create Tag in Settings**: Settings → Tags tab → Type "重要" in search box → Press Enter → New tag created with random color from palette
32. **Reorder Tags**: Settings → Tags tab → Drag "重要" tag above other tags → Order updates everywhere (file header, tag filter, file icon colors)
33. **Assign Tag to File**: Right-click file → "タグを編集" → Tag dialog opens → Click "重要" tag → Tag becomes colored (assigned) → Click again → Tag becomes transparent (unassigned)
34. **Tag Badge Display**: Open file with tags → File header shows tag badges after filename in order → Click sell icon button → Tag dialog opens for editing
35. **Edit Tag**: Settings → Tags tab → Right-click "重要" tag → Select "編集" → Change name to "優先度高" and select red color from palette → Save → Tag updated everywhere
36. **Filter by Tag**: Click tag filter button → Click "優先度高" tag once (shows) → Only files with that tag appear → Click again (hides) → Files with that tag hidden → Click again (none) → All files shown
37. **Clear Tag Filters**: Click tag filter button → Set multiple tags to show/hide → Click "クリア" button in header → All filters reset, all files shown
38. **Tag with Search**: Type "TODO" in search box → Click tag filter button → Set "優先度高" to show → Only files containing "TODO" AND tagged "優先度高" appear
39. **File Icon Colors**: File with tags shows docs icon in file list → Icon color matches first tag's color (by order) → Reorder tags in settings → Icon color updates to new first tag

**Process Management**
- **Cross-Platform Exit**: App terminates completely on window close (Windows, macOS, Linux)
- **Clean Shutdown**: All timers and resources are properly cleaned up on exit
- **Session Auto-Save**: Session state saved on every tab operation for maximum reliability

**macOS Specific Error Handling**
- **IMK Error Suppression**: Handles `IMKCFRunLoopWakeUpReliable` errors from macOS Input Method Kit without crashing
- **GPU Compositing Disabled**: Prevents display compositor issues that can cause input method conflicts
- **Uncaught Exception Handling**: Specifically filters and handles IMK-related errors while preserving normal error handling
- **Safe Dock Icon Setting**: Gracefully handles dock icon setting failures