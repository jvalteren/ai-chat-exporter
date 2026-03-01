
/**
 * ChatGPT Chat Exporter - Content script
 * Adds an export UI, lets users pick which messages to include,
 * and downloads/copies perfectly formatted Markdown.
 */

(function() {
  'use strict';

  // ============================================================================
  // CONSTANTS
  // ============================================================================
  const CONFIG = {
    BUTTON_ID: 'chatgpt-export-btn',
    DROPDOWN_ID: 'chatgpt-export-dropdown',
    FILENAME_INPUT_ID: 'chatgpt-filename-input',
    SELECT_DROPDOWN_ID: 'chatgpt-select-dropdown',
    CHECKBOX_CLASS: 'chatgpt-export-checkbox',
    EXPORT_MODE_NAME: 'chatgpt-export-mode',

    SELECTORS: {
      CONVERSATION_TURN: 'article[data-testid^="conversation-turn-"]',
      USER_HEADING: 'h5.sr-only',
      MODEL_HEADING: 'h6.sr-only',
      COPY_BUTTON: 'button[data-testid="copy-turn-action-button"]',
      THREAD_TITLE: 'main h1'
    },

    CHAT_CONTAINER_CANDIDATES: [
      'div[data-testid="conversation-turns"]',
      'div[aria-label="Chat history"]',
      'div.flex.h-full.flex-col.overflow-y-auto',
      'div.flex.h-full.w-full.flex-col.overflow-y-auto',
      'main div.flex-1.overflow-y-auto',
      'main div.overflow-y-auto'
    ],

    TIMING: {
      SCROLL_DELAY: 2000,
      MAX_SCROLL_ATTEMPTS: 60,
      MAX_STABLE_SCROLLS: 4,
      CLIPBOARD_CLEAR_DELAY: 150,
      CLIPBOARD_READ_DELAY: 300,
      MAX_CLIPBOARD_ATTEMPTS: 10,
      POPUP_DURATION: 1000
    },

    STYLES: {
      BUTTON_PRIMARY: '#1a73e8',
      BUTTON_HOVER: '#1765c1',
      DARK_BG: '#111',
      DARK_TEXT: '#fff',
      DARK_BORDER: '#444',
      LIGHT_BG: '#fff',
      LIGHT_TEXT: '#222',
      LIGHT_BORDER: '#ccc'
    },

    PROJECT_EXPORT: {
      MAX_LOAD_ATTEMPTS: 60,
      LOAD_DELAY: 2000,
      BACK_NAVIGATION_DELAY: 5000,
      CONVERSATION_LOAD_TIMEOUT: 10000,
      MAX_CONVERSATIONS_WITHOUT_WARNING: 50,
      BUTTON_ID: 'chatgpt-project-export-btn',
      SELECTORS: {
        PROJECT_TABS: '[id^="project-home-tabs-"]',
        CHATS_PANEL: '[role="tabpanel"][id*="content-chats"]',
        CONVERSATION_LIST_ITEM: 'li.group\\/project-item',
        CONVERSATION_LINK: 'a[href*="/c/"]',
        CONVERSATION_TITLE: '.text-sm.font-medium',
        CONVERSATION_DATE: '[data-testid="project-conversation-overflow-date"]',
        LOAD_MORE_BUTTON: 'button.btn'
      }
    }
  };

  // ============================================================================
  // UTILITIES
  // ============================================================================
  const Utils = {
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    isDarkMode() {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    },

    sanitizeFilename(text) {
      return text
        .replace(/[\\/:*?"<>|.]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    },

    getDateString() {
      const d = new Date();
      const pad = n => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    },

    createNotification(message) {
      const popup = document.createElement('div');
      Object.assign(popup.style, {
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: '99999',
        background: '#333',
        color: '#fff',
        padding: '9px 16px',
        borderRadius: '6px',
        fontSize: '0.95em',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        pointerEvents: 'none'
      });
      popup.textContent = message;
      document.body.appendChild(popup);
      setTimeout(() => popup.remove(), CONFIG.TIMING.POPUP_DURATION);
      return popup;
    }
  };

  // ============================================================================
  // CHECKBOX MANAGER
  // ============================================================================
  class CheckboxManager {
    create(turn, type, topOffset) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = `${CONFIG.CHECKBOX_CLASS} ${type}`;
      checkbox.checked = true;
      checkbox.title = `Include this ${type === 'user' ? 'user' : 'ChatGPT'} message`;

      Object.assign(checkbox.style, {
        position: 'absolute',
        right: '28px',
        top: topOffset,
        zIndex: '10000',
        transform: 'scale(1.2)'
      });

      if (turn.style.position !== 'relative') {
        turn.style.position = 'relative';
      }

      turn.appendChild(checkbox);
      return checkbox;
    }

    injectCheckboxes() {
      const turns = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN);

      turns.forEach(turn => {
        const userHeading = turn.querySelector(CONFIG.SELECTORS.USER_HEADING);
        if (userHeading && !turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.user`)) {
          this.create(turn, 'user', '8px');
        }

        const modelHeading = turn.querySelector(CONFIG.SELECTORS.MODEL_HEADING);
        if (modelHeading && !turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.model`)) {
          this.create(turn, 'model', '36px');
        }
      });
    }

    removeAll() {
      document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.remove());
    }

    anyChecked() {
      return Array.from(document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`)).some(cb => cb.checked);
    }
  }

  // ============================================================================
  // SELECTION MANAGER
  // ============================================================================
  class SelectionManager {
    constructor() {
      this.lastSelection = 'all';
    }

    apply(value) {
      switch (value) {
        case 'all':
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.checked = true);
          break;
        case 'ai':
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}.user`).forEach(cb => cb.checked = false);
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}.model`).forEach(cb => cb.checked = true);
          break;
        case 'none':
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.checked = false);
          break;
      }
      this.lastSelection = value;
    }

    resetDropdown() {
      const dropdown = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (dropdown) {
        dropdown.value = 'all';
      }
      this.lastSelection = 'all';
    }
  }

  // ============================================================================
  // UI BUILDER
  // ============================================================================
  class UIBuilder {
    static getInputStyles() {
      const isDark = Utils.isDarkMode();
      return isDark
        ? `background:${CONFIG.STYLES.DARK_BG};color:${CONFIG.STYLES.DARK_TEXT};border:1px solid ${CONFIG.STYLES.DARK_BORDER};`
        : `background:${CONFIG.STYLES.LIGHT_BG};color:${CONFIG.STYLES.LIGHT_TEXT};border:1px solid ${CONFIG.STYLES.LIGHT_BORDER};`;
    }

    static createButton() {
      const button = document.createElement('button');
      button.id = CONFIG.BUTTON_ID;
      button.textContent = 'Export Chat';

      Object.assign(button.style, {
        position: 'fixed',
        top: '80px',
        right: '20px',
        zIndex: '9999',
        padding: '8px 16px',
        background: CONFIG.STYLES.BUTTON_PRIMARY,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '1em',
        fontWeight: 'bold',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'background 0.2s'
      });

      button.addEventListener('mouseenter', () => button.style.background = CONFIG.STYLES.BUTTON_HOVER);
      button.addEventListener('mouseleave', () => button.style.background = CONFIG.STYLES.BUTTON_PRIMARY);

      return button;
    }

    static createDropdown() {
      const dropdown = document.createElement('div');
      dropdown.id = CONFIG.DROPDOWN_ID;

      Object.assign(dropdown.style, {
        position: 'fixed',
        top: '124px',
        right: '20px',
        zIndex: '9999',
        border: '1px solid #ccc',
        borderRadius: '6px',
        padding: '10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        display: 'none',
        background: Utils.isDarkMode() ? '#222' : '#fff',
        color: Utils.isDarkMode() ? '#fff' : '#222'
      });

      const inputStyles = this.getInputStyles();

      dropdown.innerHTML = `
        <div style="margin-top:10px;">
          <label style="margin-right:10px;">
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="file" checked>
            Export as file
          </label>
          <label>
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="clipboard">
            Export to clipboard
          </label>
        </div>
        <div id="chatgpt-filename-row" style="margin-top:10px;display:block;">
          <label for="${CONFIG.FILENAME_INPUT_ID}" style="font-weight:bold;">
            Filename <span style="color:#888;font-weight:normal;">(optional)</span>:
          </label>
          <input id="${CONFIG.FILENAME_INPUT_ID}" type="text" value=""
                 style="margin-left:8px;padding:2px 8px;width:260px;${inputStyles}">
          <span style="display:block;font-size:0.93em;color:#888;margin-top:2px;">
            Leave blank to use chat title or a timestamp. Do not include an extension.
          </span>
        </div>
        <div style="margin-top:14px;">
          <label style="font-weight:bold;">Select messages:</label>
          <select id="${CONFIG.SELECT_DROPDOWN_ID}" style="margin-left:8px;padding:2px 8px;${inputStyles}">
            <option value="all">All</option>
            <option value="ai">Only answers</option>
            <option value="none">None</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      `;

      return dropdown;
    }
  }

  // ============================================================================
  // EXPORT SERVICE
  // ============================================================================
  class ExportService {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
    }

    getChatContainer() {
      for (const selector of CONFIG.CHAT_CONTAINER_CANDIDATES) {
        const el = document.querySelector(selector);
        if (el) return el;
      }

      const firstTurn = document.querySelector(CONFIG.SELECTORS.CONVERSATION_TURN);
      if (firstTurn) {
        const overflowAncestor = firstTurn.closest('div.overflow-y-auto, div.flex-1, main');
        if (overflowAncestor) return overflowAncestor;
        return firstTurn.parentElement;
      }

      return null;
    }

    async scrollToLoadAll() {
      const container = this.getChatContainer();
      if (!container) {
        throw new Error('Could not find chat history container. Are you on a ChatGPT page?');
      }

      let stableScrolls = 0;
      let attempts = 0;
      let lastScrollTop = null;

      while (stableScrolls < CONFIG.TIMING.MAX_STABLE_SCROLLS && attempts < CONFIG.TIMING.MAX_SCROLL_ATTEMPTS) {
        const currentTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        container.scrollTop = 0;
        await Utils.sleep(CONFIG.TIMING.SCROLL_DELAY);

        const newTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        const currentTop = container.scrollTop;

        if (newTurnCount === currentTurnCount && (lastScrollTop === currentTop || currentTop === 0)) {
          stableScrolls++;
        } else {
          stableScrolls = 0;
        }

        lastScrollTop = currentTop;
        attempts++;
      }
    }

    async copyModelResponse(copyButton) {
      try {
        await navigator.clipboard.writeText('');
      } catch (e) {
        // Ignore clipboard clear errors
      }

      let attempts = 0;
      while (attempts < CONFIG.TIMING.MAX_CLIPBOARD_ATTEMPTS) {
        copyButton.click();
        await Utils.sleep(CONFIG.TIMING.CLIPBOARD_READ_DELAY);
        const text = await navigator.clipboard.readText();
        if (text) {
          return text;
        }
        attempts++;
        await Utils.sleep(CONFIG.TIMING.CLIPBOARD_CLEAR_DELAY);
      }

      return '';
    }

    getConversationTitle() {
      const heading = document.querySelector(CONFIG.SELECTORS.THREAD_TITLE);
      if (heading?.textContent?.trim()) return heading.textContent.trim();
      return document.title?.trim() || '';
    }

    generateFilename(custom, title) {
      const baseTimestamp = Utils.getDateString();

      if (custom?.trim()) {
        let base = custom.trim().replace(/\.[^/.]+$/, '');
        base = base.replace(/[^a-zA-Z0-9_\-]/g, '_');
        return base || `chatgpt_chat_export_${baseTimestamp}`;
      }

      if (title) {
        const safe = Utils.sanitizeFilename(title);
        if (safe) return `${safe}_${baseTimestamp}`;
      }

      return `chatgpt_chat_export_${baseTimestamp}`;
    }

    async buildMarkdown(turns, title, exportAll = false) {
      let markdown = title
        ? `# ${title}\n\n`
        : '# ChatGPT Chat Export\n\n';
      markdown += `> Exported on: ${new Date().toLocaleString()}\n\n---\n\n`;

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        Utils.createNotification(`Processing message ${i + 1} of ${turns.length}...`);

        // User content comes after the sr-only heading element
        const userHeading = turn.querySelector(CONFIG.SELECTORS.USER_HEADING);
        const userCheckbox = turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.user`);
        if (userHeading && (exportAll || userCheckbox?.checked)) {
          const userContent = userHeading.nextElementSibling?.textContent?.trim();
          markdown += userContent
            ? `## 👤 You\n\n${userContent}\n\n`
            : `## 👤 You\n\n[Could not read your message for turn ${i + 1}.]\n\n`;
        }

        const modelHeading = turn.querySelector(CONFIG.SELECTORS.MODEL_HEADING);
        const modelCheckbox = turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.model`);
        if (modelHeading && (exportAll || modelCheckbox?.checked)) {
          const copyBtn = turn.querySelector(CONFIG.SELECTORS.COPY_BUTTON);
          if (copyBtn) {
            const clipboardText = await this.copyModelResponse(copyBtn);
            markdown += clipboardText
              ? `## 🤖 ChatGPT\n\n${clipboardText}\n\n`
              : `## 🤖 ChatGPT\n\n[Could not copy the response for turn ${i + 1}.]\n\n`;
          } else {
            markdown += `## 🤖 ChatGPT\n\n[Copy button not available for turn ${i + 1}.]\n\n`;
          }
        }

        markdown += '---\n\n';
      }

      return markdown;
    }

    async export(markdown, mode, filenameBase) {
      if (mode === 'clipboard') {
        await navigator.clipboard.writeText(markdown);
        alert('Conversation copied to clipboard!');
        return;
      }

      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filenameBase}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }, 1000);
    }

    async execute(mode, customFilename) {
      await this.scrollToLoadAll();
      this.checkboxManager.injectCheckboxes();

      if (!this.checkboxManager.anyChecked()) {
        alert('Please select at least one message to export.');
        return;
      }

      const turns = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));
      const title = this.getConversationTitle();
      const markdown = await this.buildMarkdown(turns, title);
      const filenameBase = this.generateFilename(customFilename, title);

      await this.export(markdown, mode, filenameBase);
    }
  }

  // ============================================================================
  // PROJECT PAGE DETECTION
  // ============================================================================
  function isProjectOverviewPage() {
    const isProjectUrl = /\/g\/g-p-[^/]+\/project(?:$|\?)/.test(location.pathname + location.search);
    const hasProjectHeaderTrigger = !!document.querySelector('[data-testid="project-modal-trigger"]');
    const hasProjectTabs = !!document.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.PROJECT_TABS);
    const hasChatsPanel = !!document.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.CHATS_PANEL);
    return isProjectUrl && hasProjectHeaderTrigger && hasProjectTabs && hasChatsPanel;
  }

  // ============================================================================
  // PROJECT CONVERSATION LOADER
  // ============================================================================
  class ProjectConversationLoader {
    async loadAllConversations() {
      const panel = document.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.CHATS_PANEL);
      if (!panel) throw new Error('Project chats panel not found');

      let loadAttempts = 0;
      let previousCount = 0;
      let stableLoads = 0;

      while (stableLoads < 3 && loadAttempts < CONFIG.PROJECT_EXPORT.MAX_LOAD_ATTEMPTS) {
        const currentCount = panel.querySelectorAll(CONFIG.PROJECT_EXPORT.SELECTORS.CONVERSATION_LIST_ITEM).length;

        if (currentCount === previousCount) {
          stableLoads++;
        } else {
          stableLoads = 0;
          previousCount = currentCount;
        }

        const loadMoreBtn = Array.from(panel.querySelectorAll(CONFIG.PROJECT_EXPORT.SELECTORS.LOAD_MORE_BUTTON))
          .find(btn => /load more conversations/i.test(btn.textContent || ''));

        if (!loadMoreBtn || loadMoreBtn.disabled) break;

        Utils.createNotification(`Loading conversations... (${currentCount} loaded)`);
        loadMoreBtn.click();
        await Utils.sleep(CONFIG.PROJECT_EXPORT.LOAD_DELAY);
        loadAttempts++;
      }
    }

    extractConversationInfo(element) {
      const link = element.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.CONVERSATION_LINK);
      return {
        title: element.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.CONVERSATION_TITLE)?.textContent?.trim() || 'Untitled',
        url: link?.href || null,
        date: element.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.CONVERSATION_DATE)?.textContent?.trim() || null
      };
    }

    getConversationInfoList() {
      const panel = document.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.CHATS_PANEL);
      if (!panel) return [];
      return Array.from(
        panel.querySelectorAll(CONFIG.PROJECT_EXPORT.SELECTORS.CONVERSATION_LIST_ITEM)
      ).map(item => this.extractConversationInfo(item));
    }
  }

  // ============================================================================
  // PROJECT EXPORT CONTROLLER
  // ============================================================================
  class ProjectExportController {
    constructor() {
      this.loader = new ProjectConversationLoader();
      this.exportService = new ExportService(null);
      this.button = null;
      this.cancelRequested = false;
      this.projectUrl = window.location.href;
    }

    init() {
      this.button = this._createButton();
      document.body.appendChild(this.button);
      this.button.addEventListener('click', () => this.handleButtonClick());
      this._observeVisibility();
    }

    _createButton() {
      const button = document.createElement('button');
      button.id = CONFIG.PROJECT_EXPORT.BUTTON_ID;
      button.textContent = 'Export Project';
      Object.assign(button.style, {
        position: 'fixed',
        top: '80px',
        right: '20px',
        zIndex: '9999',
        padding: '8px 16px',
        background: CONFIG.STYLES.BUTTON_PRIMARY,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '1em',
        fontWeight: 'bold',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'background 0.2s'
      });
      button.addEventListener('mouseenter', () => button.style.background = CONFIG.STYLES.BUTTON_HOVER);
      button.addEventListener('mouseleave', () => button.style.background = CONFIG.STYLES.BUTTON_PRIMARY);
      return button;
    }

    async handleButtonClick() {
      const panel = document.querySelector(CONFIG.PROJECT_EXPORT.SELECTORS.CHATS_PANEL);
      if (!panel) {
        alert('Could not find the project chats panel.');
        return;
      }

      const visibleCount = panel.querySelectorAll(CONFIG.PROJECT_EXPORT.SELECTORS.CONVERSATION_LIST_ITEM).length;
      if (visibleCount > CONFIG.PROJECT_EXPORT.MAX_CONVERSATIONS_WITHOUT_WARNING) {
        const proceed = confirm(
          `This project has at least ${visibleCount} conversations. Export may take several minutes. Continue?`
        );
        if (!proceed) return;
      }

      this.cancelRequested = false;
      this.button.disabled = true;
      this.button.textContent = 'Exporting...';

      try {
        await this.runExport();
      } catch (error) {
        console.error('Project export error:', error);
        alert(`Export failed: ${error.message}`);
      } finally {
        this.button.disabled = false;
        this.button.textContent = 'Export Project';
      }
    }

    async runExport() {
      // Step 1: Load all conversations
      Utils.createNotification('Loading all conversations...');
      await this.loader.loadAllConversations();
      if (this.cancelRequested) return;

      // Step 2: Snapshot info as plain JS objects (no DOM refs)
      const conversationList = this.loader.getConversationInfoList();
      const total = conversationList.length;

      if (total === 0) {
        alert('No conversations found in this project.');
        return;
      }

      if (total > CONFIG.PROJECT_EXPORT.MAX_CONVERSATIONS_WITHOUT_WARNING) {
        const minutes = Math.round(total * 4 / 60);
        const proceed = confirm(
          `${total} conversations found. Estimated time: ~${minutes} minutes. Continue?`
        );
        if (!proceed) return;
      }

      const projectTitle = document.querySelector('h1')?.textContent?.trim() || 'project';
      const zip = new window.JSZip();
      const folder = zip.folder(Utils.sanitizeFilename(projectTitle));
      let successCount = 0;

      // Step 3: Navigate to each conversation, extract, navigate back
      for (let i = 0; i < total; i++) {
        if (this.cancelRequested) break;

        const info = conversationList[i];
        Utils.createNotification(`Extracting (${i + 1}/${total}): ${info.title}`);

        try {
          await this._navigateToConversation(info);
          const turns = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));
          const markdown = await this.exportService.buildMarkdown(turns, info.title, true);
          const filename = `${Utils.sanitizeFilename(info.title)}_${Utils.getDateString()}.md`;
          folder.file(filename, markdown);
          successCount++;
        } catch (error) {
          console.error(`Failed to extract "${info.title}":`, error);
          folder.file(
            `${Utils.sanitizeFilename(info.title)}_ERROR.md`,
            `[Failed to extract: ${error.message}]`
          );
        }

        await this._navigateBackToProject();
      }

      if (this.cancelRequested) {
        alert('Export cancelled.');
        return;
      }

      // Step 4: Generate and download ZIP
      Utils.createNotification('Generating ZIP...');
      try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${Utils.sanitizeFilename(projectTitle)}_${Utils.getDateString()}.zip`;
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
        }, 1000);
        alert(`Successfully exported ${successCount} of ${total} conversations.`);
      } catch (zipError) {
        console.error('ZIP generation failed:', zipError);
        alert(`ZIP generation failed: ${zipError.message}`);
      }
    }

    async _navigateToConversation(info) {
      if (!info.url) throw new Error('No URL for conversation');
      const pathname = new URL(info.url).pathname;
      const link = document.querySelector(`a[href="${pathname}"]`);
      if (link) {
        link.click();
      } else {
        window.location.href = info.url;
      }
      const found = await this._waitForElement(CONFIG.SELECTORS.CONVERSATION_TURN, CONFIG.PROJECT_EXPORT.CONVERSATION_LOAD_TIMEOUT);
      if (!found) throw new Error(`Timed out loading conversation: ${info.title}`);
    }

    async _navigateBackToProject() {
      window.history.back();
      const ok = await this._waitForElement(
        CONFIG.PROJECT_EXPORT.SELECTORS.CHATS_PANEL,
        CONFIG.PROJECT_EXPORT.BACK_NAVIGATION_DELAY
      );
      if (!ok) {
        window.location.href = this.projectUrl;
        await this._waitForElement(
          CONFIG.PROJECT_EXPORT.SELECTORS.CHATS_PANEL,
          CONFIG.PROJECT_EXPORT.BACK_NAVIGATION_DELAY
        );
      }
    }

    async _waitForElement(selector, maxWaitMs) {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        if (document.querySelector(selector)) return true;
        await Utils.sleep(200);
      }
      return false;
    }

    _observeVisibility() {
      const update = () => {
        try {
          if (chrome?.storage?.sync) {
            chrome.storage.sync.get(['hideExportBtn'], (result) => {
              this.button.style.display = result.hideExportBtn ? 'none' : '';
            });
          }
        } catch (error) {
          console.error('Storage access error:', error);
        }
      };
      update();
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && 'hideExportBtn' in changes) update();
        });
      }
    }
  }

  // ============================================================================
  // CONTROLLER
  // ============================================================================
  class ExportController {
    constructor() {
      this.checkboxManager = new CheckboxManager();
      this.selectionManager = new SelectionManager();
      this.exportService = new ExportService(this.checkboxManager);
      this.button = null;
      this.dropdown = null;
    }

    init() {
      this.button = UIBuilder.createButton();
      this.dropdown = UIBuilder.createDropdown();
      document.body.appendChild(this.button);
      document.body.appendChild(this.dropdown);
      this.bindEvents();
      this.observeVisibility();
      this.toggleFilenameRow();
    }

    bindEvents() {
      this.button.addEventListener('click', () => this.handleButtonClick());

      this.dropdown.querySelector(`#${CONFIG.SELECT_DROPDOWN_ID}`)
        .addEventListener('change', (event) => {
          const value = event.target.value;
          this.checkboxManager.injectCheckboxes();
          this.selectionManager.apply(value);
        });

      document.addEventListener('change', (event) => {
        if (event.target?.classList?.contains(CONFIG.CHECKBOX_CLASS)) {
          const dropdown = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
          if (dropdown && dropdown.value !== 'custom') {
            dropdown.value = 'custom';
            this.selectionManager.lastSelection = 'custom';
          }
        }
      });

      document.addEventListener('mousedown', (event) => {
        if (this.dropdown.style.display !== 'none' &&
            !this.dropdown.contains(event.target) &&
            event.target !== this.button) {
          this.dropdown.style.display = 'none';
        }
      });
    }

    toggleFilenameRow() {
      const radios = this.dropdown.querySelectorAll(`input[name="${CONFIG.EXPORT_MODE_NAME}"]`);
      const filenameRow = this.dropdown.querySelector('#chatgpt-filename-row');

      const update = () => {
        const fileRadio = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"][value="file"]`);
        if (filenameRow && fileRadio) {
          filenameRow.style.display = fileRadio.checked ? 'block' : 'none';
        }
      };

      radios.forEach(radio => radio.addEventListener('change', update));
      update();
    }

    async handleButtonClick() {
      this.checkboxManager.injectCheckboxes();

      if (this.dropdown.style.display === 'none') {
        this.dropdown.style.display = '';
        return;
      }

      this.button.disabled = true;
      this.button.textContent = 'Exporting...';
      this.dropdown.style.display = 'none';

      try {
        const mode = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"]:checked`)?.value || 'file';
        const filenameInput = this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`);
        const customFilename = mode === 'file' ? filenameInput?.value?.trim() || '' : '';

        await this.exportService.execute(mode, customFilename);

        this.checkboxManager.removeAll();
        this.selectionManager.resetDropdown();
        if (filenameInput) filenameInput.value = '';

      } catch (error) {
        console.error('Export error:', error);
        alert(`Export failed: ${error.message}`);
      } finally {
        this.button.disabled = false;
        this.button.textContent = 'Export Chat';
      }
    }

    observeVisibility() {
      const update = () => {
        try {
          if (chrome?.storage?.sync) {
            chrome.storage.sync.get(['hideExportBtn'], (result) => {
              this.button.style.display = result.hideExportBtn ? 'none' : '';
            });
          }
        } catch (error) {
          console.error('Storage access error:', error);
        }
      };

      update();

      const observer = new MutationObserver(update);
      observer.observe(document.body, { childList: true, subtree: true });

      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && 'hideExportBtn' in changes) {
            update();
          }
        });
      }
    }
  }

  // ============================================================================
  // INIT
  // ============================================================================
  if (isProjectOverviewPage()) {
    new ProjectExportController().init();
  } else {
    new ExportController().init();
  }

})();
