/*
 * Gemini-like DOM fixtures for the locator/content-script tests.
 *
 * Each function returns an HTML string. Layout-dependent heuristics read a
 * `data-rect="x,y,w,h"` attribute (the tests plug a rect hook that parses
 * it), because jsdom has no layout.
 */
'use strict';

const ACCOUNT_LABEL = 'Google Account: Jane Doe  \n(jane@gmail.com)';

function header(opts) {
  opts = opts || {};
  if (opts.signedOut) {
    return '<header class="gb_Ta"><a class="gb_Ba" href="https://accounts.google.com/ServiceLogin?continue=https://gemini.google.com/app">Sign in</a></header>';
  }
  return '<header class="gb_Ta">'
    + '<a class="gb_B gb_Za" aria-label="' + ACCOUNT_LABEL + '" href="https://accounts.google.com/SignOutOptions?hl=en&continue=https://gemini.google.com/app" role="button">'
    + '<img class="gb_P gbii" src="data:," alt="Jane Doe" data-rect="1200,10,32,32"></a></header>';
}

function wizScript(email) {
  return '<script nonce="x">window.WIZ_global_data = {"Im6cmf":"/_/BardChatUi","oPEP7c":"' + (email || 'jane@gmail.com') + '","S06Grb":"123"};</script>';
}

function sideNav(opts) {
  opts = opts || {};
  return '<bard-sidenav class="ng-star-inserted"><mat-sidenav role="navigation">'
    + '<side-nav-action-button data-test-id="new-chat-button" class="ng-tns-c123">'
    + '<button class="mat-mdc-button mdc-button explicit-gmat-override" aria-label="New chat" data-rect="20,80,180,40"' + (opts.newChatDisabled ? ' aria-disabled="true"' : '') + '>'
    + '<mat-icon data-mat-icon-name="edit_square" class="mat-icon">edit_square</mat-icon><span class="mdc-button__label">New chat</span></button>'
    + '</side-nav-action-button>'
    + '<div class="conversations-container"><a href="/app/abc123" class="conversation">Old chat</a></div>'
    + '</mat-sidenav></bard-sidenav>';
}

function modeSwitcher(name) {
  return '<bard-mode-switcher class="ng-star-inserted"><button data-test-id="bard-mode-menu-button" class="mat-mdc-menu-trigger gds-mode-switch-button" aria-haspopup="menu" aria-expanded="false" data-rect="300,20,120,36">'
    + '<span class="logo-pill-label-container"><span class="mode-title">' + (name || '2.5 Pro') + '</span></span>'
    + '<mat-icon data-mat-icon-name="arrow_drop_down" class="mat-icon">arrow_drop_down</mat-icon></button></bard-mode-switcher>';
}

function userQuery(text) {
  return '<user-query class="ng-star-inserted"><div class="user-query-container"><span class="query-text">' + text + '</span></div></user-query>';
}

function modelResponse(opts) {
  opts = opts || {};
  return '<model-response class="ng-star-inserted"><div class="response-container">'
    + (opts.generating ? '<mat-progress-bar role="progressbar" class="mat-mdc-progress-bar" data-rect="300,400,600,4"></mat-progress-bar>' : '')
    + '<message-content class="model-response-text"><div class="markdown markdown-main-panel">' + (opts.html || '') + '</div></message-content>'
    + (opts.finished ? '<message-actions class="ng-star-inserted"><div class="buttons-container">'
      + '<button class="mat-mdc-icon-button" aria-label="Good response" data-rect="300,500,40,40"><mat-icon data-mat-icon-name="thumb_up">thumb_up</mat-icon></button>'
      + '<button class="mat-mdc-icon-button" aria-label="Bad response" data-rect="340,500,40,40"><mat-icon data-mat-icon-name="thumb_down">thumb_down</mat-icon></button>'
      + '<button class="mat-mdc-icon-button copy-button" aria-label="Copy" data-rect="380,500,40,40"><mat-icon data-mat-icon-name="content_copy">content_copy</mat-icon></button>'
      + '</div></message-actions>' : '')
    + '</div></model-response>';
}

function promptBox(opts) {
  opts = opts || {};
  const text = opts.text ? '<p>' + opts.text + '</p>' : '<p><br></p>';
  let button;
  if (opts.generating) {
    button = '<button class="mat-mdc-icon-button send-button stop" aria-label="Stop response" data-rect="1000,900,48,48"><mat-icon data-mat-icon-name="stop" class="mat-icon">stop</mat-icon></button>';
  } else if (opts.text) {
    button = '<button class="mat-mdc-icon-button send-button submit" aria-label="Send message" data-rect="1000,900,48,48"><mat-icon data-mat-icon-name="send" class="mat-icon">send</mat-icon></button>';
  } else {
    button = '<button class="mat-mdc-icon-button mic-button" aria-label="Use microphone" data-rect="1000,900,48,48"><mat-icon data-mat-icon-name="mic" class="mat-icon">mic</mat-icon></button>';
  }
  return '<input-container class="ng-star-inserted"><div class="input-area-container"><div class="text-input-field">'
    + '<rich-textarea class="text-input-field_textarea"><div class="ql-editor textarea new-input-ui" contenteditable="true" role="textbox" aria-label="Enter a prompt here" data-placeholder="Ask Gemini" data-rect="300,880,650,40">' + text + '</div></rich-textarea>'
    + '<div class="trailing-actions-wrapper">'
    + '<button class="mat-mdc-icon-button upload-button" aria-label="Add files" data-rect="940,900,48,48"><mat-icon data-mat-icon-name="add_2" class="mat-icon">add_2</mat-icon></button>'
    + button
    + '</div></div></div></input-container>';
}

function page(parts) {
  parts = parts || {};
  return '<!DOCTYPE html><html><head><title>' + (parts.title || 'Gemini') + '</title>' + (parts.script != null ? parts.script : wizScript()) + '</head><body>'
    + (parts.header != null ? parts.header : header())
    + '<div class="app-container"><chat-app>'
    + (parts.nav != null ? parts.nav : sideNav())
    + '<main class="content-container">'
    + '<div class="top-bar">' + (parts.switcher != null ? parts.switcher : modeSwitcher()) + '</div>'
    + '<div class="conversation-container">' + (parts.conversation || '') + '</div>'
    + (parts.prompt != null ? parts.prompt : promptBox())
    + '</main></chat-app></div>'
    + '<div class="cdk-overlay-container">' + (parts.overlay || '') + '</div>'
    + (parts.extra || '')
    + '</body></html>';
}

// ---- states ---------------------------------------------------------------

function emptyChat() { return page({ prompt: promptBox() }); }

function textTyped(text) { return page({ prompt: promptBox({ text: text || 'Hello there' }) }); }

function generating(text) {
  return page({
    conversation: userQuery('Say hi') + modelResponse({ generating: true, html: '<p>' + (text || 'Hel') + '</p>' }),
    prompt: promptBox({ generating: true }),
  });
}

function finished(text) {
  return page({
    conversation: userQuery('Say hi') + modelResponse({ finished: true, html: '<p>' + (text || 'Hello! How can I help?') + '</p>' }),
    prompt: promptBox(),
  });
}

function signedOut() {
  return '<!DOCTYPE html><html><head><title>Gemini</title></head><body>'
    + header({ signedOut: true })
    + '<main class="landing"><h1>Meet Gemini</h1><a class="landing-cta" href="https://accounts.google.com/v3/signin/identifier?continue=https://gemini.google.com/app">Sign in</a></main>'
    + '</body></html>';
}

function modelMenuOverlay(selectedName) {
  const items = [
    { name: '2.5 Flash', desc: 'Fast all-round help' },
    { name: '2.5 Pro', desc: 'Reasoning, math & code' },
    { name: 'Deep Research', desc: 'Get in-depth reports' },
  ];
  return '<div class="cdk-overlay-backdrop cdk-overlay-backdrop-showing"></div><div class="cdk-overlay-pane">'
    + '<div class="mat-mdc-menu-panel" role="menu">'
    + items.map((it) => '<button class="mat-mdc-menu-item bard-mode-list-button' + (it.name === (selectedName || '2.5 Pro') ? ' is-selected' : '') + '" role="menuitemradio" aria-checked="' + (it.name === (selectedName || '2.5 Pro')) + '" data-rect="300,60,240,56">'
      + '<div class="mode-title-container"><span class="mode-title">' + it.name + '</span><span class="mode-desc">' + it.desc + '</span></div></button>').join('')
    + '</div></div>';
}

function modelMenuOpen(selectedName) {
  return page({ overlay: modelMenuOverlay(selectedName) });
}

// A redesigned Gemini: no rich-textarea / ql-editor classes, model pill next
// to the prompt box, icon-only new-chat button, no data-test-ids anywhere.
function alternate() {
  return page({
    nav: '<nav class="side"><button class="nc-btn" aria-label="New chat" data-rect="20,80,40,40"><mat-icon data-mat-icon-name="edit_square">edit_square</mat-icon></button></nav>',
    switcher: '',
    prompt: '<div class="composer"><div class="input-area">'
      + '<div class="prompt-input" contenteditable="true" role="textbox" aria-label="Enter a prompt here" data-placeholder="Ask Gemini" data-rect="300,880,650,40"><p>Draft me a haiku</p></div>'
      + '</div><div class="composer-actions">'
      + '<button class="pill" aria-haspopup="menu" aria-expanded="false" data-rect="300,930,80,32"><span class="pill-label">Pro</span><mat-icon data-mat-icon-name="arrow_drop_down">arrow_drop_down</mat-icon></button>'
      + '<button class="mic" aria-label="Use microphone" data-rect="940,900,48,48"><mat-icon data-mat-icon-name="mic">mic</mat-icon></button>'
      + '<button class="go" aria-label="Send message" data-rect="1000,900,48,48"><mat-icon data-mat-icon-name="arrow_upward">arrow_upward</mat-icon></button>'
      + '</div></div>',
  });
}

// The send button changed just enough that every builtin strategy misses:
// class, aria-label and icon differ, no data-test-id, and it lives outside
// the prompt-box container without layout info.
function healingBroken() {
  return page({
    prompt: '<input-container><div class="input-area-container"><div class="text-input-field">'
      + '<rich-textarea><div class="ql-editor textarea" contenteditable="true" role="textbox" aria-label="Enter a prompt here" data-placeholder="Ask Gemini"><p>Hello there</p></div></rich-textarea>'
      + '<button class="mat-mdc-icon-button mic-button" aria-label="Use microphone"><mat-icon data-mat-icon-name="mic">mic</mat-icon></button>'
      + '</div></div></input-container>'
      + '<div class="composer-footer"><button class="mat-mdc-icon-button submit-btn" aria-label="Send prompt now"><mat-icon data-mat-icon-name="arrow_forward">arrow_forward</mat-icon></button></div>',
  });
}

function withError(kind) {
  const toast = '<mat-snack-bar-container class="mat-mdc-snack-bar-container"><div class="mat-mdc-snack-bar-label">Something went wrong. Please try again later.</div></mat-snack-bar-container>';
  if (kind === 'toast') return page({ overlay: toast, prompt: promptBox() });
  return page({
    conversation: userQuery('Say hi') + modelResponse({ finished: true, html: '<p>Something went wrong.</p>' }),
    prompt: promptBox(),
  });
}

module.exports = {
  ACCOUNT_LABEL,
  header, wizScript, sideNav, modeSwitcher, userQuery, modelResponse, promptBox, page, modelMenuOverlay,
  emptyChat, textTyped, generating, finished, signedOut, modelMenuOpen, alternate, healingBroken, withError,
};
