# Feature Specification: Bulk Export All ChatGPT Project Conversations

## 1. Overview

**Feature Name**: Project-level Bulk Export  
**Scope**: Export all conversations within a ChatGPT project to multiple individual Markdown files (ZIP archive or sequential downloads)  
**Entry Point**: ChatGPT Project Overview Page  
**Target User**: Users who want to archive or backup entire projects at once

## 2. UI/UX Design

### 2.1 Button Placement & Visibility

**Location**: Fixed position in top-right corner (consistent with existing export button)

- **Position**: Same as current single-chat export button (top: 80px, right: 20px)
- **Visibility Condition**: Only show on project overview pages (detect via URL pattern or page structure)
- **Button Text**: "Export Project"
- **Z-index**: 9999 (consistent with existing implementation)

**Detection Logic**:

```javascript
isProjectOverviewPage() {
  // Scope to project home view, not generic chat/sidebar DOM
  const isProjectUrl = /\/g\/g-p-[^/]+\/project(?:$|\?)/.test(location.pathname + location.search);
  const hasProjectHeaderTrigger = !!document.querySelector('[data-testid="project-modal-trigger"]');
  const hasProjectTabs = !!document.querySelector('[id^="project-home-tabs-"]');
  const hasChatsPanel = !!document.querySelector('[role="tabpanel"][id*="content-chats"]');

  return isProjectUrl && hasProjectHeaderTrigger && hasProjectTabs && hasChatsPanel;
}
```

### 2.2 Export Options Modal/Dropdown

When user clicks "Export Project" button, display dropdown with following options:

```
┌─────────────────────────────────────────────┐
│  Export Format:                             │
│  ○ Multiple files (one per conversation)    │
├─────────────────────────────────────────────┤
│  Export Destination:                        │
│  ○ Download to computer                     │
├─────────────────────────────────────────────┤
│  Options:                                   │
│  ☑ Include conversation titles              │
│  ☑ Include timestamps                       │
│  ☑ Load all conversations first             │
├─────────────────────────────────────────────┤
│  [Cancel]  [Export Project]                 │
└─────────────────────────────────────────────┘
```

**Form Fields**:

- Export Format (radio button):
  - "Multiple files (one per conversation)" - creates ZIP or downloads sequentially
  
- Export Destination (radio button):
  - "Download to computer" (default, always available)
  
- Checkboxes:
  - "Include conversation titles" (checked by default)
  - "Include timestamps" (checked by default)
  - "Load all conversations first" (checked by default)

## 3. Core Functionality

### 3.1 Conversation Discovery & Loading

**Goal**: Identify and load all conversations in the project

**Algorithm**:

```
1. Scope to the project chats tab panel: [role="tabpanel"][id*="content-chats"]
2. Query conversation items inside panel only: panel.querySelectorAll('li.group\\/project-item')
2. Extract conversation count from each item
3. While "Load more conversations" button is visible AND enabled:
   a. Wait for current batch to render (500ms)
   b. Find button by text inside panel (CSS `:contains` is invalid)
   c. Click "Load more conversations" button
   c. Wait for new conversations to appear (2000ms)
   d. Recount conversations
4. Return final list of all conversation elements
```

**Key Considerations**:

- **Pagination Detection**: Button visibility indicates more conversations available
- **Load Timeout**: Max 60 attempts (matches existing scroll timeout pattern)
- **Load Indicator**: Show progress: "Loading conversations... (42 of ∞)"
- **Memory Management**: Don't store full conversation content in memory during load phase

**Implementation Location**: New class `ProjectConversationLoader`

```javascript
class ProjectConversationLoader {
  async loadAllConversations(maxAttempts = 60) {
    let loadAttempts = 0;
    let previousCount = 0;
    let stableLoads = 0;
    const panel = document.querySelector('[role="tabpanel"][id*="content-chats"]');
    if (!panel) throw new Error('Project chats panel not found');
    
    while (stableLoads < 3 && loadAttempts < maxAttempts) {
      const currentConversations = panel.querySelectorAll('li.group\\/project-item');
      const currentCount = currentConversations.length;
      
      // Update UI with progress
      this.updateLoadProgress(currentCount);
      
      // Check if we've reached stability
      if (currentCount === previousCount) {
        stableLoads++;
      } else {
        stableLoads = 0;
      }
      
      // Look for "Load more" button
      const loadMoreBtn = Array.from(panel.querySelectorAll('button'))
        .find(btn => /load more conversations/i.test(btn.textContent || ''));
      if (!loadMoreBtn || loadMoreBtn.disabled) {
        break;
      }
      
      // Click and wait
      loadMoreBtn.click();
      await Utils.sleep(2000);
      
      previousCount = currentCount;
      loadAttempts++;
    }
    
    return panel.querySelectorAll('li.group\\/project-item');
  }
  
  extractConversationInfo(element) {
    return {
      title: element.querySelector('.text-sm.font-medium')?.textContent?.trim(),
      url: element.querySelector('a')?.href,
      createdDate: element.querySelector('[data-testid="project-conversation-overflow-date"]')?.textContent,
      element: element // Keep reference for navigation
    };
  }
}
```

### 3.2 Conversation Content Extraction

**Goal**: Extract full conversation content from each conversation link

**Chosen Approach: Navigation-Based (reuse existing export logic)**

- Click each conversation link sequentially
- Wait for page to load
- Extract content using existing ChatGPT extraction logic
- Navigate back to project overview
- Repeat for next conversation

```javascript
class ProjectConversationExtractor {
  async extractAllConversations(conversationList, showProgress = true) {
    const conversations = [];
    const totalCount = conversationList.length;
    
    for (let i = 0; i < totalCount; i++) {
      const item = conversationList[i];
      const info = this.extractConversationInfo(item);
      
      if (showProgress) {
        Utils.createNotification(`Extracting (${i + 1}/${totalCount}): ${info.title}`);
      }
      
      try {
        // Click to navigate to conversation
        const link = item.querySelector('a');
        link.click();
        
        // Wait for page to load
        await Utils.sleep(1500);
        
        // Extract using existing logic
        const turns = Array.from(
          document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN)
        );
        const content = await this.extractConversationContent(turns, info.title);
        
        conversations.push({
          title: info.title,
          url: info.url,
          createdDate: info.createdDate,
          content: content,
          turns: turns.length
        });
        
        // Navigate back to project overview
        window.history.back();
        await Utils.sleep(1000);
        
      } catch (error) {
        console.error(`Failed to extract conversation: ${info.title}`, error);
        conversations.push({
          title: info.title,
          error: error.message,
          content: `[Failed to extract: ${error.message}]`
        });
      }
    }
    
    return conversations;
  }
  
  async extractConversationContent(turns, title) {
    let markdown = `## ${title}\n\n`;
    
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      
      // User message
      const userHeading = turn.querySelector(CONFIG.SELECTORS.USER_HEADING);
      const userCheckbox = turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.user`);
      if (userHeading && userCheckbox?.checked) {
        const userContent = userHeading.nextElementSibling?.textContent?.trim();
        markdown += userContent
          ? `**You**: ${userContent}\n\n`
          : `**You**: [Unable to extract]\n\n`;
      }
      
      // Model message
      const modelHeading = turn.querySelector(CONFIG.SELECTORS.MODEL_HEADING);
      const modelCheckbox = turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.model`);
      if (modelHeading && modelCheckbox?.checked) {
        const copyBtn = turn.querySelector(CONFIG.SELECTORS.COPY_BUTTON);
        if (copyBtn) {
          const clipboardText = await this.copyModelResponse(copyBtn);
          markdown += clipboardText
            ? `**ChatGPT**: ${clipboardText}\n\n`
            : `**ChatGPT**: [Unable to extract]\n\n`;
        }
      }
      
      markdown += '---\n\n';
    }
    
    return markdown;
  }
}
```

### 3.3 Markdown Generation

**Multiple Files Format** (Individual):
Each conversation gets its own file with naming: `ProjectName_ConversationTitle_YYYY-MM-DD_HHMMSS.md`

**Structure**:

```markdown
# [Conversation Title]

**Project**: [Project Name]  
**Exported on**: [Timestamp]

[Conversation content...]
```

### 3.4 File Output Handling

**Default Delivery: ZIP Archive**
Requires including a ZIP library (e.g., `jszip`).

```javascript
async downloadAsZip(conversations, projectName) {
  const zip = new JSZip();
  const folder = zip.folder(projectName);
  
  for (const conv of conversations) {
    const filename = `${conv.title}_${DateUtils.getDateString()}.md`;
    folder.file(filename, conv.content);
  }
  
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${projectName}_${DateUtils.getDateString()}.zip`;
  anchor.click();
}
```

**Fallback Delivery: Sequential Downloads**

```javascript
async downloadMultipleFiles(conversations, projectName) {
  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    const filename = `${projectName}_${conv.title}_${DateUtils.getDateString()}`;
    
    FileExportService.downloadMarkdown(conv.content, filename);
    
    // Stagger downloads to avoid browser blocking
    if (i < conversations.length - 1) {
      await Utils.sleep(500);
    }
  }
}
```

## 4. UI/UX Workflow

### 4.1 Step-by-Step User Flow

```
1. User navigates to ChatGPT project overview page
   ↓
2. "Export Project" button appears (top-right)
   ↓
3. User clicks button → Modal/dropdown opens with options
   ↓
4. User selects:
   - Format (multiple files)
   - Destination (download)
   - Options (include titles, timestamps, auto-load)
   ↓
5. User clicks "Export Project"
   ↓
6. If "Load all conversations first" checked:
    - Show progress: "Loading conversations... (42/∞)"
    - Click "Load more" button repeatedly until all loaded
   ↓
7. For each conversation:
   - Show progress: "Extracting (5/42): Conversation Title"
   - Navigate to conversation, extract content, navigate back
   ↓
8. Build Markdown file(s)
   ↓
9. Export:
   - Download as ZIP archive (fallback to sequential downloads if ZIP fails)
   ↓
10. Show completion: "Successfully exported 42 conversations"
```

### 4.2 Progress Indicators

**Active Export Progress Modal**:

```
┌────────────────────────────────────────┐
│  Exporting Project...                  │
├────────────────────────────────────────┤
│  Stage: Loading conversations          │
│  [████████░░░░░░░░░░░░░] 42%            │
│  Loaded: 42 / ∞ conversations          │
│                                        │
│  Current: Extracting "Budget 2024..."  │
│  [████░░░░░░░░░░░░░░░░░░] 8%            │
│  Extracted: 5 / 42 conversations       │
│                                        │
│  Elapsed: 2m 15s  |  Est. Time: 4m 20s│
├────────────────────────────────────────┤
│  [Cancel Export]                       │
└────────────────────────────────────────┘
```

## 5. Error Handling & Edge Cases

### 5.1 Failure Scenarios

| Scenario | Handling | User Feedback |
|----------|----------|---------------|
| "Load more" fails | Stop loading, proceed with loaded conversations | "Loaded 34 of ~50 conversations. Proceeding with available conversations." |
| Conversation extraction fails | Log error, continue to next, include error note in output | "[Failed to extract: Timeout loading conversation]" |
| Page navigation fails (back button) | Retry navigation or reload project page | "Navigation failed, reloading project overview..." |
| User navigates away mid-export | Cancel gracefully, show confirmation | "Cancel export? Conversations exported so far will be lost." |
| Network timeout | Retry with exponential backoff (3 attempts) | "Connection timeout, retrying... (Attempt 2/3)" |
| Browser memory/performance issues | Implement chunking for large projects | "Large project detected. Processing in batches to avoid performance issues." |
| User cancels export | Stop current flow, clean up UI, no partial files | "Export canceled. No files were saved." |

### 5.2 Validation

```javascript
validateExportState() {
  const panel = document.querySelector('[role="tabpanel"][id*="content-chats"]');
  if (!panel) {
    throw new Error('Project chats panel not found');
  }

  const conversationList = panel.querySelectorAll('li.group\\/project-item');
  
  if (conversationList.length === 0) {
    throw new Error('No conversations found in project');
  }
  
  const loadMoreBtn = Array.from(panel.querySelectorAll('button'))
    .find(btn => /load more conversations/i.test(btn.textContent || ''));
  if (loadMoreBtn?.disabled === false) {
    // More conversations available
    return { ready: true, hasMore: true };
  }
  
  return { ready: true, hasMore: false };
}
```

## 6. Implementation Architecture

### 6.1 New Classes & Modifications

**New Classes**:

1. `ProjectExportController` - Main orchestrator for project export
2. `ProjectConversationLoader` - Handles loading all conversations via "Load more"
3. `ProjectConversationExtractor` - Extracts content from individual conversations
4. `ProjectMarkdownBuilder` - Builds per-conversation Markdown files

**Modified Classes**:

1. `ExportController` - Add project page detection, new button for projects
2. `UIBuilder` - Add project export modal/dropdown UI
3. `FileExportService` - Extend to support ZIP export

**Existing Reuse**:

- `Utils` utilities (sleep, isDarkMode, sanitizeFilename, etc.)
- Existing ChatGPT extraction logic from `ExportService`
- Storage/visibility observation from `ExportController.observeVisibility()`

### 6.2 File Structure

```
src/
├── content_scripts/
│   └── chatgpt.js (MODIFIED - add project export logic)
│       ├── ProjectExportController (NEW)
│       ├── ProjectConversationLoader (NEW)
│       ├── ProjectConversationExtractor (NEW)
│       ├── ProjectMarkdownBuilder (NEW)
│       ├── ExportController (MODIFIED)
│       └── [existing classes]
└── lib/
    ├── jszip.min.js (NEW - if implementing ZIP support)
    └── turndown.js (existing)
```

### 6.3 Config Updates

```javascript
const CONFIG = {
  // ... existing config ...
  
  PROJECT_EXPORT: {
    MAX_LOAD_ATTEMPTS: 60,
    LOAD_DELAY: 2000,
    CONVERSATION_EXTRACT_DELAY: 1500,
    BACK_NAVIGATION_DELAY: 1000,
    BATCH_DOWNLOAD_DELAY: 500,
    EXTRACTION_RETRY_ATTEMPTS: 3,
    SELECTORS: {
      PROJECT_TABS: '[id^="project-home-tabs-"]',
      CHATS_PANEL: '[role="tabpanel"][id*="content-chats"]',
      CONVERSATION_LIST_ITEM: 'li.group\\/project-item',
      CONVERSATION_TITLE: '.text-sm.font-medium',
      CONVERSATION_DATE: '[data-testid="project-conversation-overflow-date"]',
      CONVERSATION_LINK: 'li.group\\/project-item > a[href*="/c/"]',
      LOAD_MORE_BUTTON_CANDIDATE: 'button.btn'
    }
  }
};
```

## 7. Performance Considerations

### 7.1 Optimization Strategies

**For Large Projects (50+ conversations)**:

1. **Batch Processing**: Load conversations in batches of 10, extract in parallel streams
2. **Lazy Loading**: Don't keep all conversation content in memory simultaneously
3. **Caching**: Cache extracted conversation content to avoid re-extraction if user retries
4. **Throttling**: Limit concurrent operations to prevent browser overwhelm

**Memory Management**:

```javascript
class ConversationBuffer {
  constructor(maxSize = 5) {
    this.buffer = [];
    this.maxSize = maxSize;
  }
  
  add(conversation) {
    this.buffer.push(conversation);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift(); // Remove oldest
    }
  }
  
  flush(callback) {
    // Process buffer when it reaches maxSize
    if (this.buffer.length >= this.maxSize) {
      callback(this.buffer);
      this.buffer = [];
    }
  }
}
```

### 7.2 Estimated Performance

| Project Size | Estimated Time | Notes |
|--------------|----------------|-------|
| 5 conversations | 30-45 seconds | Load + 1-2s per conversation |
| 20 conversations | 2-3 minutes | More "Load more" clicks |
| 50 conversations | 5-8 minutes | Significant page navigation overhead |
| 100+ conversations | 10-15 minutes | Consider warning users |

**MVP Warning Rule**:

- Show a large-project warning if conversation count exceeds `MAX_CONVERSATIONS_WITHOUT_WARNING` before extraction.

## 8. Testing Checklist

### 8.1 Functional Tests

- [ ] "Export Project" button only appears on project overview pages
- [ ] "Load more" functionality properly loads all available conversations
- [ ] Progress indicators update correctly during load and extraction
- [ ] Conversation extraction captures user and AI messages correctly
- [ ] Navigation back to project overview succeeds after each conversation
- [ ] Multiple-file export creates proper ZIP structure
- [ ] Error handling doesn't crash extension (failed conversation gracefully skipped)
- [ ] Cancel button stops export and allows user to exit
- [ ] Large-project warning appears before extraction when threshold exceeded

### 8.2 Edge Cases

- [ ] Project with 0 conversations
- [ ] Project with 1 conversation
- [ ] Conversations with very long titles (filename sanitization)
- [ ] Conversations with special characters in content
- [ ] Network interruption during extraction
- [ ] Browser navigation away from project during export
- [ ] User manually clicking project links during export
- [ ] Very large projects (100+ conversations) for performance

### 8.3 Browser Compatibility

- [ ] Chrome/Chromium (primary)
- [ ] Edge
- [ ] Opera (if supporting)

## 9. Future Enhancements

1. **Selective Conversation Export**: Checkboxes on project overview to select specific conversations
2. **Search & Filter**: Export only conversations matching certain criteria (date range, keyword)
3. **Export Templates**: Custom Markdown templates for different use cases
4. **Scheduled Exports**: Automatic backup of projects on schedule
5. **API Integration**: Export to cloud storage (Google Drive, Dropbox, OneDrive)
6. **Comparison Tool**: Side-by-side diff of project versions over time
7. **Metadata Preservation**: Store conversation metadata (message count, tokens, etc.) in structured format (JSON alongside Markdown)

## 10. Security & Privacy Considerations

### 10.1 Data Handling

- ✅ All content stays local (no external transmission)
- ✅ Downloaded files contain only conversation content (no extension data)
- ✅ ZIP archives are generated locally, never uploaded

### 10.2 Potential Risks

⚠️ **Large File Handling**: Multi-file exports could create large ZIP files  
→ **Mitigation**: Warn users if projected file size > 100MB

⚠️ **Sensitive Content**: Users may export conversations containing sensitive information  
→ **Mitigation**: Add privacy notice before export

⚠️ **Permission Scope**: May require expanded host permissions for project pages  
→ **Mitigation**: Ensure manifest only requests necessary permissions

## 11. Implementation Roadmap

### Phase 1: MVP (Scope for initial implementation)

- [x] Button placement and visibility detection
- [x] "Load more" conversation loading
- [x] Single conversation extraction  
- [x] Multiple-file export (ZIP or sequential)
- [x] Basic error handling
- [x] Progress indicators
- [x] Cancel export support
- [x] Large-project warning prior to extraction

### Phase 2: Enhanced UX

- [ ] Zip performance optimizations for large exports
- [ ] Advanced options (include/exclude metadata)
- [ ] Better error recovery

### Phase 3: Optimization

- [ ] Batch processing for large projects
- [ ] Parallel extraction streams
- [ ] Export caching
- [ ] Performance optimizations

## 12. Configuration Example

```javascript
// In chatgpt.js CONFIG
PROJECT_EXPORT: {
  ENABLED: true,
  MAX_LOAD_ATTEMPTS: 60,
  LOAD_DELAY: 2000,
  CONVERSATION_EXTRACT_DELAY: 1500,
  BACK_NAVIGATION_DELAY: 1000,
  MAX_CONVERSATIONS_WITHOUT_WARNING: 50,
  
  SELECTORS: {
    PROJECT_TABS: '[id^="project-home-tabs-"]',
    CHATS_PANEL: '[role="tabpanel"][id*="content-chats"]',
    CONVERSATION_LIST_ITEM: 'li.group\\/project-item',
    CONVERSATION_LINK: 'li.group\\/project-item > a[href*="/c/"]',
    CONVERSATION_TITLE: '.text-sm.font-medium',
    CONVERSATION_DATE: '[data-testid="project-conversation-overflow-date"]',
    LOAD_MORE_BUTTON_CANDIDATE: 'button.btn'
  },
  
  MESSAGES: {
    BUTTON_LABEL: 'Export Project',
    MODAL_TITLE: 'Export Project',
    LOADING: 'Loading conversations...',
    EXTRACTING: 'Extracting conversation content...',
    SUCCESS: 'Successfully exported {count} conversations',
    ERROR: 'Export failed: {error}'
  }
}
```

## Summary

This specification provides a comprehensive, phased approach to extending the AI Chat Exporter with project-level bulk export functionality. The design prioritizes:

1. **User Experience**: Clear progress indicators, manageable workflows
2. **Performance**: Chunking, progress feedback, memory management
3. **Reliability**: Error handling, graceful degradation, retry logic
4. **Privacy**: Local-only processing, no external transmission
5. **Maintainability**: Clear architecture, reusable components, well-documented

The MVP scope focuses on core functionality (loading all conversations and exporting to multiple per-conversation files with ZIP delivery and sequential fallback), with enhanced features (parallel processing) available in subsequent phases.

## 13. Testing Strategy (Pragmatic)

**Goal**: Validate selector stability, export correctness, and user-visible reliability without exhaustive automation.

**Layers**:

1. **DOM Snapshot Validation** (static)
   - Re-validate selectors against stored snapshots (like [`specs/project-overview.html`](specs/project-overview.html)).
   - Verify key anchors: project tabs, chats panel, list items, load-more button text.
2. **Manual Smoke Tests** (primary)
   - Run through export on small (1–3), medium (10–20), and large (50+) project sizes.
   - Validate ZIP contents and file naming patterns.
   - Confirm UI visibility only on project overview pages.
3. **Failure Mode Checks**
   - Simulate load-more failure (disable button, slow network) and ensure graceful messaging.
   - Force navigation interruption mid-export and confirm cancel/rollback behavior.
4. **Regression Guardrails**
   - Maintain a short checklist aligned to the DOM-dependent selectors.
   - Re-run after any upstream UI changes or selector updates.

**Exit Criteria**:

- 0 blocking failures on manual smoke tests.
- No empty files in ZIP for successful conversation extractions.
- Export completes with correct count and filenames.

## 14. Finalized Decisions

1. **Content Extraction**: Navigation-based extraction only, reusing existing ChatGPT export logic.
2. **Delivery Method**: ZIP archive by default with sequential downloads as fallback.
3. **Load-More Strategy**: Text-match the Load more conversations button inside the chats panel.
4. **MVP UX Requirements**: Provide cancel support and large-project warning before extraction.
