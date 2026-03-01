/**
 * Unit tests for ExportService.buildMarkdown() with the exportAll flag.
 *
 * TDD role:
 *   - Tests for exportAll = true were written BEFORE the flag was added (red).
 *   - Adding `exportAll = false` parameter + condition guards made them green.
 *   - Tests for exportAll = false (default) confirm existing single-chat behaviour
 *     is unchanged (regression guard).
 *
 * These tests run in jsdom without a real browser or clipboard. The clipboard
 * dependency (copyModelResponse) is mocked to return predictable text.
 */

// ---------------------------------------------------------------------------
// Minimal inline implementation of the parts under test.
// We don't import chatgpt.js directly (it's a content script IIFE), so we
// replicate only the logic being tested. Keep this in sync with chatgpt.js.
// ---------------------------------------------------------------------------

const CHECKBOX_CLASS = 'chatgpt-export-checkbox';
const COPY_BUTTON_SELECTOR = 'button[data-testid="copy-turn-action-button"]';
const USER_HEADING_SELECTOR = 'h5.sr-only';
const MODEL_HEADING_SELECTOR = 'h6.sr-only';

async function buildMarkdown(turns, title, exportAll = false, copyModelResponse) {
  let markdown = title ? `# ${title}\n\n` : '# ChatGPT Chat Export\n\n';
  markdown += `> Exported on: ${new Date().toLocaleString()}\n\n---\n\n`;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    const userHeading = turn.querySelector(USER_HEADING_SELECTOR);
    const userCheckbox = turn.querySelector(`.${CHECKBOX_CLASS}.user`);
    if (userHeading && (exportAll || userCheckbox?.checked)) {
      const userContent = userHeading.nextElementSibling?.textContent?.trim();
      markdown += userContent
        ? `## 👤 You\n\n${userContent}\n\n`
        : `## 👤 You\n\n[Could not read your message for turn ${i + 1}.]\n\n`;
    }

    const modelHeading = turn.querySelector(MODEL_HEADING_SELECTOR);
    const modelCheckbox = turn.querySelector(`.${CHECKBOX_CLASS}.model`);
    if (modelHeading && (exportAll || modelCheckbox?.checked)) {
      const copyBtn = turn.querySelector(COPY_BUTTON_SELECTOR);
      if (copyBtn) {
        const clipboardText = await copyModelResponse(copyBtn);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTurn({ userText = 'Hello', modelText = 'Hi there', withCheckboxes = false } = {}) {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'conversation-turn-1');

  // User heading + sibling content
  const userHeading = document.createElement('h5');
  userHeading.className = 'sr-only';
  userHeading.textContent = 'You said:';
  const userContent = document.createElement('div');
  userContent.textContent = userText;
  article.appendChild(userHeading);
  article.appendChild(userContent);

  if (withCheckboxes) {
    const userCb = document.createElement('input');
    userCb.type = 'checkbox';
    userCb.className = `${CHECKBOX_CLASS} user`;
    userCb.checked = true;
    article.appendChild(userCb);
  }

  // Model heading + copy button
  const modelHeading = document.createElement('h6');
  modelHeading.className = 'sr-only';
  modelHeading.textContent = 'ChatGPT said:';
  article.appendChild(modelHeading);

  const copyBtn = document.createElement('button');
  copyBtn.setAttribute('data-testid', 'copy-turn-action-button');
  copyBtn.textContent = 'Copy';
  article.appendChild(copyBtn);

  if (withCheckboxes) {
    const modelCb = document.createElement('input');
    modelCb.type = 'checkbox';
    modelCb.className = `${CHECKBOX_CLASS} model`;
    modelCb.checked = true;
    article.appendChild(modelCb);
  }

  return { article, copyBtn, modelText };
}

const mockCopy = (modelText) => async (_btn) => modelText;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildMarkdown — exportAll = false (default / single-chat behaviour)', () => {
  test('skips all turns when no checkboxes are injected', async () => {
    const { article, copyBtn, modelText } = makeTurn({ withCheckboxes: false });
    const markdown = await buildMarkdown([article], 'Test Chat', false, mockCopy(modelText));
    expect(markdown).not.toContain('👤 You');
    expect(markdown).not.toContain('🤖 ChatGPT');
  });

  test('includes turns when checkboxes are present and checked', async () => {
    const { article, copyBtn, modelText } = makeTurn({ withCheckboxes: true });
    const markdown = await buildMarkdown([article], 'Test Chat', false, mockCopy(modelText));
    expect(markdown).toContain('👤 You');
    expect(markdown).toContain('Hello');
    expect(markdown).toContain('🤖 ChatGPT');
    expect(markdown).toContain('Hi there');
  });
});

describe('buildMarkdown — exportAll = true (bulk export behaviour)', () => {
  test('includes all turns even without checkboxes injected', async () => {
    const { article, modelText } = makeTurn({ withCheckboxes: false });
    const markdown = await buildMarkdown([article], 'Bulk Chat', true, mockCopy(modelText));
    expect(markdown).toContain('👤 You');
    expect(markdown).toContain('Hello');
    expect(markdown).toContain('🤖 ChatGPT');
    expect(markdown).toContain('Hi there');
  });

  test('includes correct title in header', async () => {
    const { article, modelText } = makeTurn({ withCheckboxes: false });
    const markdown = await buildMarkdown([article], 'My Project Chat', true, mockCopy(modelText));
    expect(markdown).toContain('# My Project Chat');
  });

  test('includes all turns across multiple conversations', async () => {
    const turns = [
      makeTurn({ userText: 'First question', modelText: 'First answer', withCheckboxes: false }),
      makeTurn({ userText: 'Second question', modelText: 'Second answer', withCheckboxes: false })
    ];
    const articles = turns.map(t => t.article);
    const markdown = await buildMarkdown(
      articles,
      'Multi-turn Chat',
      true,
      async (btn) => {
        // Return different text based on which turn we're in (simplified mock)
        const turn = btn.closest('article');
        return turn === articles[0] ? 'First answer' : 'Second answer';
      }
    );
    expect(markdown).toContain('First question');
    expect(markdown).toContain('First answer');
    expect(markdown).toContain('Second question');
    expect(markdown).toContain('Second answer');
  });

  test('includes error placeholder when copy returns empty string', async () => {
    const { article } = makeTurn({ withCheckboxes: false });
    const markdown = await buildMarkdown([article], 'Empty Chat', true, async () => '');
    expect(markdown).toContain('Could not copy the response');
  });
});
