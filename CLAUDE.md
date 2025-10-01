# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Application Title
- **Application Name**: memo3
- **Window Title**: memo3

## Commands

### Running the Application
- `npm start` - Launch the Electron app in production mode
- `npm run dev` - Launch the Electron app in development mode

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
  - `workspace.json` - Workspace configuration (root folder path)
  - `settings.json` - Editor configuration (keybindings, themes, font size, whitespace display)
  - `session.json` - Session state (open tabs, active tab, editor states)

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
- **File-System Management**: Select root folder, auto-scan .md/.txt files, real-time file watching, filters temporary files
- **Multi-Tab Interface**: Open multiple files in tabs with drag-and-drop tab reordering
- **Session Restoration**: Automatically restores open tabs and editor states on app restart
- **Enhanced Search**: Search both filenames and file content with detailed results display
- **Editor Controls**: Font size adjustment, whitespace character display, theme toggle, markdown preview, developer tools access
- **Theme Toggle**: Quick switching between two user-configured themes via 🎨 button
- **Auto-Save**: Automatic save 5 seconds after editing, prevents saving unchanged files
- **Smart New File Creation**: + button creates files when 2+ non-empty lines exist, auto-generates filenames from content
- **File List Display**: Shows title (first non-empty line), filename, and full modification date/time
- **Context Menus**: Right-click files for rename/delete, right-click status bar for developer tools
- **ACE Editor Integration**: Customizable keybindings, themes with app-wide theme matching
- **Tab Management**: Drag-and-drop reordering, smart closing, editor focus on new tab creation, scroll buttons for many tabs
- **Real-time Updates**: File changes detected automatically, file list order updates on modification
- **External Change Handling**: Auto-reload files modified by external editors, preserves cursor and scroll position

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
- `get-session`, `save-session` - Session state management (open tabs, active tab)
- `select-folder` - Folder selection with immediate UI update (no restart required)

**Preview Window**
- `open-preview` - Open markdown preview in separate window
- `update-preview` - Update preview window content
- `preview-update` - Event to notify preview window of content changes

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
- **Change Detection**: Compares content before saving to prevent unnecessary file updates
- **Close Auto-Save**: Automatically saves modified files when closing tabs
- **Smart Closing**: Auto-closes unused tabs when opening new files from file list
- **File List Updates**: Automatically updates file order when files are modified
- **Temporary File Filtering**: Ignores editor backup files (~), swap files (.swp), hidden files (.), and system files (.DS_Store, .tmp)

**Enhanced Search System**
- **Dual Search Mode**: Search both filenames and file content simultaneously
- **Results Categorization**: Separate display for filename matches vs content matches
- **Line Number Display**: Show line numbers for content matches
- **Visual Indicators**: Color-coded match types (filename: blue, content: teal)
- **Direct Navigation**: Click search results to open files directly
- **Clear Function**: Easy search reset with × button

**Session Restoration**
- **Complete State Persistence**: Saves all open tabs, active tab, and file states
- **Automatic Restoration**: Restores session on app restart without user intervention
- **File Validation**: Only restores tabs for files that still exist
- **Content Restoration**: Reloads file content and maintains editor state
- **Smart Recovery**: Handles missing files gracefully during restoration

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
- **Real-Time Sorting**: Automatically reorders by modification time when files change
- **Clean Interface**: Removed file list header and new file button for minimal design

**Context Menu System**
- **File Context Menu**: Right-click files for "ファイル名更新" (filename update) and "削除" (delete)
- **Status Bar Context Menu**: Right-click status bar for "開発者ツール" (developer tools)
- **Editor Context Menu**: Right-click in editor for URL opening, Google search, and standard editing functions
- **Smart Positioning**: Context menus automatically adjust position to stay within screen bounds
- **Filename Updates**: Auto-generates new filenames based on file content, preserves extensions
- **Safety Confirmations**: Confirmation dialogs before file deletion

**Advanced Editor Features**
- **URL Detection**: Automatically detects URLs in text, right-click to open in browser
- **Text Selection Search**: Select text and right-click to search on Google
- **Markdown Preview**: Separate window for live markdown preview with dark/light mode toggle
- **Preview Controls**: Theme toggle, print, zoom out, 1:1 (reset), zoom in buttons in top-right corner
- **Preview Rendering**: Proper hierarchy display with aligned headings, nested lists, and horizontal rules (----)
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

**Process Management**
- **Cross-Platform Exit**: App terminates completely on window close (Windows, macOS, Linux)
- **Clean Shutdown**: All timers and resources are properly cleaned up on exit
- **Session Auto-Save**: Session state saved on every tab operation for maximum reliability

**macOS Specific Error Handling**
- **IMK Error Suppression**: Handles `IMKCFRunLoopWakeUpReliable` errors from macOS Input Method Kit without crashing
- **GPU Compositing Disabled**: Prevents display compositor issues that can cause input method conflicts
- **Uncaught Exception Handling**: Specifically filters and handles IMK-related errors while preserving normal error handling
- **Safe Dock Icon Setting**: Gracefully handles dock icon setting failures