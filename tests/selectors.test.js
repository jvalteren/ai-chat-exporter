/**
 * Selector regression tests — validates all PROJECT_EXPORT selectors against
 * the captured project-overview.html snapshot.
 *
 * TDD role: run these FIRST (before implementing); they should pass immediately
 * as a green baseline. Re-run after any ChatGPT UI update; a failure here means
 * a selector needs updating in CONFIG.PROJECT_EXPORT.SELECTORS before shipping.
 */

const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = path.resolve(__dirname, '../specs/project-overview.html');
const SELECTORS = {
  PROJECT_TABS:            '[id^="project-home-tabs-"]',
  CHATS_PANEL:             '[role="tabpanel"][id*="content-chats"]',
  CONVERSATION_LIST_ITEM:  'li.group\\/project-item',
  CONVERSATION_LINK:       'a[href*="/c/"]',
  CONVERSATION_TITLE:      '.text-sm.font-medium',
  CONVERSATION_DATE:       '[data-testid="project-conversation-overflow-date"]',
  LOAD_MORE_BUTTON:        'button.btn',
  PROJECT_MODAL_TRIGGER:   '[data-testid="project-modal-trigger"]'
};

let document;

beforeAll(() => {
  const html = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
  document = new DOMParser().parseFromString(html, 'text/html');
});

describe('PROJECT_EXPORT selectors against project-overview.html snapshot', () => {
  test('CHATS_PANEL finds exactly one element', () => {
    const els = document.querySelectorAll(SELECTORS.CHATS_PANEL);
    expect(els.length).toBe(1);
  });

  test('PROJECT_TABS finds at least one element', () => {
    const els = document.querySelectorAll(SELECTORS.PROJECT_TABS);
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  test('PROJECT_MODAL_TRIGGER is present', () => {
    const el = document.querySelector(SELECTORS.PROJECT_MODAL_TRIGGER);
    expect(el).not.toBeNull();
  });

  test('CONVERSATION_LIST_ITEM finds at least one conversation', () => {
    const items = document.querySelectorAll(SELECTORS.CONVERSATION_LIST_ITEM);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  test('each list item contains a CONVERSATION_LINK with /c/ in href', () => {
    const items = document.querySelectorAll(SELECTORS.CONVERSATION_LIST_ITEM);
    items.forEach(item => {
      const link = item.querySelector(SELECTORS.CONVERSATION_LINK);
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toMatch(/\/c\//);
    });
  });

  test('each list item contains a CONVERSATION_TITLE with non-empty text', () => {
    const items = document.querySelectorAll(SELECTORS.CONVERSATION_LIST_ITEM);
    items.forEach(item => {
      const title = item.querySelector(SELECTORS.CONVERSATION_TITLE);
      expect(title).not.toBeNull();
      expect(title.textContent.trim().length).toBeGreaterThan(0);
    });
  });

  test('each list item contains a CONVERSATION_DATE element', () => {
    const items = document.querySelectorAll(SELECTORS.CONVERSATION_LIST_ITEM);
    items.forEach(item => {
      const date = item.querySelector(SELECTORS.CONVERSATION_DATE);
      expect(date).not.toBeNull();
    });
  });

  test('LOAD_MORE_BUTTON with "Load more conversations" text is present', () => {
    const buttons = Array.from(document.querySelectorAll(SELECTORS.LOAD_MORE_BUTTON));
    const loadMoreBtn = buttons.find(btn =>
      /load more conversations/i.test(btn.textContent || '')
    );
    expect(loadMoreBtn).not.toBeUndefined();
  });

  test('isProjectOverviewPage() pattern matches project URL', () => {
    const projectPath = '/g/g-p-69674b90902481919d00aee66e7fac93-context-driven-engineering/project';
    const matches = /\/g\/g-p-[^/]+\/project(?:$|\?)/.test(projectPath);
    expect(matches).toBe(true);
  });

  test('isProjectOverviewPage() pattern does not match regular chat URL', () => {
    const chatPath = '/c/69a068fe-aba8-832d-8b52-740b9295d190';
    const matches = /\/g\/g-p-[^/]+\/project(?:$|\?)/.test(chatPath);
    expect(matches).toBe(false);
  });
});
