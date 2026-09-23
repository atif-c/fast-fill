// ==UserScript==
// @name         Fast Fill
// @namespace    http://github.com/atif-c
// @version      0.0.1
// @description  Fast text fill (Ctrl + Shift + Space)
// @author       Atif C
// @match        *://*/*
// @run-at       document-idle
// @license      Unlicense
// ==/UserScript==
(() => {
    'use strict';
    /* Add entries by editing DEFAULT_PLACEHOLDERS below, e.g. 'brb': 'be right
       back', e.g. 'search': "search '{{_}}'". Only {{_}} is special. Single
       Ctrl+Shift+Space on a trigger fills + replaces every {{_}} with clipboard
       text. Double Ctrl+Shift+Space fills only: deletes every {{_}}, parks
       cursor where first {{_}} was. Escape: `\{{_}}` in a value inserts literal
       {{_}} and never reads       clipboard. Keys must be \w+ words
       (letters/digits/underscore) to    match WORD_RE lookup. */
    const DEFAULT_PLACEHOLDERS = Object.freeze({
        ser: 'search "{{_}}"'
    });
    // Map avoids prototype-pollution keys (__proto__, constructor) entirely.
    const placeholders = new Map(Object.entries(DEFAULT_PLACEHOLDERS));
    const DEBUG = false;
    const EDIT_ID = 'fast-fill';
    const WORD_RE = /(\w+)$/;
    const SUPPORTED_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'tel']);
    const DOUBLE_TAP_MS = 350;
    const SLOT = '{{_}}';
    const ESCAPED_SEQ = '\\{{_}}';
    // Placeholder char protecting escaped `\{{_}}` while resolving.
    const ESCAPED_SLOT = '\uE000';
    // Pending single-press candidate waiting to disambiguate a double-tap.
    let pendingCandidate = null;
    const debug = (...args) => {
        if (DEBUG) {
            console.debug('[fast-fill]', ...args);
        }
    };
    const hasPlaceholder = (word) => {
        return typeof word === 'string' && word.length > 0 && placeholders.has(word);
    };
    const getWordBeforeCursor = (text) => {
        if (typeof text !== 'string' || text.length === 0) {
            return '';
        }
        const match = text.match(WORD_RE);
        return match?.[1] ?? '';
    };
    const isHotkey = (e) => {
        if (e.repeat) {
            return false;
        }
        if (!e.ctrlKey || !e.shiftKey) {
            return false;
        }
        // Avoid hijacking browser/OS shortcuts that add Alt or Meta.
        if (e.altKey || e.metaKey) {
            return false;
        }
        // Require Space: e.code is layout-independent, e.key is the fallback.
        return e.code === 'Space' || e.key === ' ';
    };
    const dispatchInputEvent = (target, data) => {
        let inputEvent;
        if (typeof InputEvent !== 'undefined') {
            inputEvent = new InputEvent('input', {
                bubbles: true,
                data,
                inputType: 'insertText'
            });
        }
        else {
            inputEvent = new Event('input', { bubbles: true });
        }
        target.dispatchEvent(inputEvent);
    };
    const hasUnescapedSlot = (template) => {
        if (typeof template !== 'string') {
            return false;
        }
        return template.split(ESCAPED_SEQ).join(ESCAPED_SLOT).includes(SLOT);
    };
    const readClipboardText = async () => {
        try {
            const value = await navigator.clipboard?.readText?.();
            return typeof value === 'string' ? value : null;
        }
        catch {
            return null;
        }
    };
    /**
     * Pure: resolve a template into output text + caret. Only {{_}} is special; other {{...}} stays
     * dead literal. `\{{_}}` is protected first so it restores to literal {{_}}.
     *
     * @returns Text + caretOffset (null means end)
     */
    const resolveTemplate = (template, { mode, clip }) => {
        const protectedStr = template.split(ESCAPED_SEQ).join(ESCAPED_SLOT);
        let text;
        let caretOffset = null;
        if (mode === 'empty') {
            const firstIdx = protectedStr.indexOf(SLOT);
            if (firstIdx !== -1) {
                let escBefore = 0;
                for (let i = 0; i < firstIdx; i++) {
                    if (protectedStr[i] === ESCAPED_SLOT) {
                        escBefore++;
                    }
                }
                caretOffset = firstIdx + escBefore * (SLOT.length - 1);
            }
            text = protectedStr.split(SLOT).join('');
        }
        else {
            if (typeof clip === 'string' && protectedStr.includes(SLOT)) {
                text = protectedStr.split(SLOT).join(clip);
            }
            else {
                // Denied/unavailable (clip == null): keep {{_}} literal.
                text = protectedStr;
            }
            caretOffset = null;
        }
        text = text.split(ESCAPED_SLOT).join(SLOT);
        return { text, caretOffset };
    };
    const peekMonacoTemplate = (activeElement) => {
        const editorNode = activeElement.closest?.('.monaco-editor');
        if (!editorNode) {
            return null;
        }
        const monaco = window.monaco;
        if (typeof monaco?.editor?.getEditors !== 'function') {
            return null;
        }
        let editor;
        try {
            editor = monaco.editor.getEditors().find((ed) => typeof ed.getDomNode === 'function' && ed.getDomNode() === editorNode);
        }
        catch {
            return null;
        }
        if (!editor) {
            return null;
        }
        const model = typeof editor.getModel === 'function' ? editor.getModel() : null;
        const position = typeof editor.getPosition === 'function' ? editor.getPosition() : null;
        if (!model || !position) {
            return null;
        }
        if (typeof position.lineNumber !== 'number' ||
            typeof position.column !== 'number' ||
            position.column < 1) {
            return null;
        }
        let lineText;
        try {
            lineText = model.getLineContent(position.lineNumber);
        }
        catch {
            return null;
        }
        if (typeof lineText !== 'string') {
            return null;
        }
        const word = getWordBeforeCursor(lineText.slice(0, position.column - 1));
        if (!hasPlaceholder(word)) {
            return null;
        }
        return placeholders.get(word) ?? null;
    };
    const peekPlainTemplate = (activeElement) => {
        if (activeElement.tagName !== 'TEXTAREA' && activeElement.tagName !== 'INPUT') {
            return null;
        }
        if (activeElement.tagName === 'INPUT' &&
            !SUPPORTED_INPUT_TYPES.has(activeElement.type)) {
            return null;
        }
        if (activeElement.readOnly ||
            activeElement.disabled) {
            return null;
        }
        if (typeof activeElement.value !== 'string') {
            return null;
        }
        if (typeof activeElement.selectionStart !== 'number' ||
            activeElement.selectionStart !==
                activeElement.selectionEnd) {
            return null;
        }
        const cursorPos = activeElement.selectionStart;
        const word = getWordBeforeCursor(activeElement.value.slice(0, cursorPos));
        if (!hasPlaceholder(word)) {
            return null;
        }
        return placeholders.get(word) ?? null;
    };
    const peekContentEditableTemplate = (activeElement) => {
        if (!activeElement.isContentEditable) {
            return null;
        }
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
            return null;
        }
        if (!activeElement.contains(sel.anchorNode)) {
            return null;
        }
        try {
            const range = sel.getRangeAt(0);
            const preRange = range.cloneRange();
            preRange.selectNodeContents(activeElement);
            preRange.setEnd(range.endContainer, range.endOffset);
            const word = getWordBeforeCursor(preRange.toString());
            if (!hasPlaceholder(word)) {
                return null;
            }
            return placeholders.get(word) ?? null;
        }
        catch {
            return null;
        }
    };
    const peekTemplate = (activeElement) => {
        return (peekMonacoTemplate(activeElement) ??
            peekPlainTemplate(activeElement) ??
            peekContentEditableTemplate(activeElement) ??
            null);
    };
    const handleMonaco = async (activeElement, text, caretOffset) => {
        const editorNode = activeElement.closest?.('.monaco-editor');
        if (!editorNode) {
            return false;
        }
        const monaco = window.monaco;
        if (typeof monaco?.editor?.getEditors !== 'function') {
            return false;
        }
        let editor;
        try {
            editor = monaco.editor.getEditors().find((ed) => typeof ed.getDomNode === 'function' && ed.getDomNode() === editorNode);
        }
        catch {
            return false;
        }
        if (!editor) {
            return false;
        }
        const model = typeof editor.getModel === 'function' ? editor.getModel() : null;
        const position = typeof editor.getPosition === 'function' ? editor.getPosition() : null;
        if (!model || !position) {
            return false;
        }
        if (typeof position.lineNumber !== 'number' ||
            typeof position.column !== 'number' ||
            position.column < 1) {
            return false;
        }
        let lineText;
        try {
            lineText = model.getLineContent(position.lineNumber);
        }
        catch {
            return false;
        }
        if (typeof lineText !== 'string') {
            return false;
        }
        const word = getWordBeforeCursor(lineText.slice(0, position.column - 1));
        if (!hasPlaceholder(word)) {
            return false;
        }
        try {
            const startColumn = position.column - word.length;
            const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column);
            if (typeof editor.pushUndoStop === 'function') {
                editor.pushUndoStop();
            }
            editor.executeEdits(EDIT_ID, [
                {
                    range,
                    text,
                    forceMoveMarkers: true
                }
            ]);
            if (typeof editor.pushUndoStop === 'function') {
                editor.pushUndoStop();
            }
            // Single-line caret math: startColumn + offset/end assumes the
            // expansion has no newlines. Multi-line templates would need
            // line/column mapping, which v1 does not attempt.
            if (typeof editor.setPosition === 'function') {
                if (typeof caretOffset === 'number') {
                    editor.setPosition({
                        lineNumber: position.lineNumber,
                        column: startColumn + caretOffset
                    });
                }
                else {
                    editor.setPosition({
                        lineNumber: position.lineNumber,
                        column: startColumn + text.length
                    });
                }
            }
        }
        catch {
            return false;
        }
        debug('Monaco replaced:', word);
        return true;
    };
    const handlePlainField = async (activeElement, text, caretOffset) => {
        if (activeElement.tagName !== 'TEXTAREA' && activeElement.tagName !== 'INPUT') {
            return false;
        }
        if (activeElement.tagName === 'INPUT' &&
            !SUPPORTED_INPUT_TYPES.has(activeElement.type)) {
            return false;
        }
        if (activeElement.readOnly ||
            activeElement.disabled) {
            return false;
        }
        if (typeof activeElement.value !== 'string') {
            return false;
        }
        // Do not corrupt an active range selection.
        if (typeof activeElement.selectionStart !== 'number' ||
            activeElement.selectionStart !==
                activeElement.selectionEnd) {
            return false;
        }
        const cursorPos = activeElement.selectionStart;
        const word = getWordBeforeCursor(activeElement.value.slice(0, cursorPos));
        if (!hasPlaceholder(word)) {
            return false;
        }
        try {
            const start = cursorPos - word.length;
            activeElement.setRangeText(text, start, cursorPos, 'end');
            dispatchInputEvent(activeElement, text);
            if (typeof caretOffset === 'number') {
                activeElement.selectionStart = activeElement.selectionEnd = start + caretOffset;
            }
        }
        catch {
            return false;
        }
        debug('plain field replaced:', word);
        return true;
    };
    /** CaretOffset is ignored in v1 (best-effort end-cursor). */
    const handleContentEditable = async (activeElement, text, caretOffset) => {
        void caretOffset;
        if (!activeElement.isContentEditable) {
            return false;
        }
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
            return false;
        }
        if (!activeElement.contains(sel.anchorNode)) {
            return false;
        }
        const range = sel.getRangeAt(0);
        const preRange = range.cloneRange();
        preRange.selectNodeContents(activeElement);
        preRange.setEnd(range.endContainer, range.endOffset);
        const word = getWordBeforeCursor(preRange.toString());
        if (!hasPlaceholder(word)) {
            return false;
        }
        if (typeof sel.modify !== 'function') {
            return false;
        }
        for (let i = 0; i < word.length; i++) {
            sel.modify('extend', 'backward', 'character');
        }
        // Preferred path preserves native undo/input handling. v1 parks cursor
        // at end of expansion (best-effort).
        if (typeof document.execCommand === 'function' &&
            document.execCommand('insertText', false, text)) {
            debug('contenteditable replaced:', word);
            return true;
        }
        // Fallback for deprecated/removed execCommand.
        try {
            const selectedRange = sel.getRangeAt(0);
            selectedRange.deleteContents();
            selectedRange.insertNode(document.createTextNode(text));
            selectedRange.collapse(false);
            sel.removeAllRanges();
            sel.addRange(selectedRange);
            dispatchInputEvent(activeElement, text);
            debug('contenteditable replaced (fallback):', word);
            return true;
        }
        catch {
            // Avoid leaving the word selected on failure.
            sel.collapseToEnd();
            return false;
        }
    };
    const applyExpansion = async (activeElement, text, caretOffset) => {
        if (await handleMonaco(activeElement, text, caretOffset)) {
            return true;
        }
        if (await handlePlainField(activeElement, text, caretOffset)) {
            return true;
        }
        if (await handleContentEditable(activeElement, text, caretOffset)) {
            return true;
        }
        return false;
    };
    const onKeyDown = async (e) => {
        if (!isHotkey(e)) {
            return;
        }
        const activeElement = document.activeElement;
        if (!(activeElement instanceof Element)) {
            return;
        }
        const template = peekTemplate(activeElement);
        if (template == null) {
            debug('no placeholder match');
            return;
        }
        e.preventDefault();
        const now = Date.now();
        if (pendingCandidate && now - pendingCandidate.time < DOUBLE_TAP_MS) {
            const pending = pendingCandidate;
            pendingCandidate = null;
            clearTimeout(pending.timerId);
            pending.resolve();
            const { text, caretOffset } = resolveTemplate(template, {
                mode: 'empty',
                clip: null
            });
            await applyExpansion(activeElement, text, caretOffset);
            return;
        }
        try {
            await new Promise(resolve => {
                const timerId = setTimeout(resolve, DOUBLE_TAP_MS);
                pendingCandidate = {
                    time: now,
                    timerId,
                    resolve,
                    element: activeElement,
                    template
                };
            });
        }
        catch {
            pendingCandidate = null;
            return;
        }
        if (!pendingCandidate) {
            // Consumed by the double-tap branch above.
            return;
        }
        const snapshotElement = pendingCandidate.element;
        const snapshotTemplate = pendingCandidate.template;
        pendingCandidate = null;
        // Snapshot was taken BEFORE any await so a clipboard permission prompt
        // cannot move focus out from under us.
        let clip = null;
        if (hasUnescapedSlot(snapshotTemplate)) {
            clip = await readClipboardText();
        }
        const { text, caretOffset } = resolveTemplate(snapshotTemplate, {
            mode: 'clipboard',
            clip
        });
        await applyExpansion(snapshotElement, text, caretOffset);
    };
    document.addEventListener('keydown', onKeyDown);
})();
