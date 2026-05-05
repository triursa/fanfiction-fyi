import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { editorTriggerImageUpload, editorTriggerLinkDialog } from '@/lib/editor-signals';

export interface SlashMenuItem {
  command: string;
  label: string;
  description: string;
  action: (editor: Editor) => void;
}

export const defaultSlashMenuItems: SlashMenuItem[] = [
  { command: 'h1', label: 'Heading 1', description: 'Large heading', action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { command: 'h2', label: 'Heading 2', description: 'Medium heading', action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { command: 'h3', label: 'Heading 3', description: 'Small heading', action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { command: 'bold', label: 'Bold', description: 'Bold text', action: (e) => e.chain().focus().toggleBold().run() },
  { command: 'italic', label: 'Italic', description: 'Italic text', action: (e) => e.chain().focus().toggleItalic().run() },
  { command: 'quote', label: 'Blockquote', description: 'Quote block', action: (e) => e.chain().focus().toggleBlockquote().run() },
  { command: 'code', label: 'Code Block', description: 'Code block', action: (e) => e.chain().focus().toggleCodeBlock().run() },
  { command: 'image', label: 'Insert Image', description: 'Upload an image', action: () => { editorTriggerImageUpload.value?.(); } },
  { command: 'link', label: 'Insert Link', description: 'Add a hyperlink', action: () => { editorTriggerLinkDialog.value?.(); } },
  { command: 'hr', label: 'Horizontal Rule', description: 'Divider line', action: (e) => e.chain().focus().setHorizontalRule().run() },
  { command: 'ordered-list', label: 'Ordered List', description: 'Numbered list', action: (e) => e.chain().focus().toggleOrderedList().run() },
  { command: 'bullet-list', label: 'Bullet List', description: 'Bulleted list', action: (e) => e.chain().focus().toggleBulletList().run() },
];

export const SlashCommandPluginKey = new PluginKey('slashCommand');

/**
 * TipTap extension that detects when the user types `/` at the start of a line or after whitespace,
 * and exposes the slash command state so the React/Preact SlashCommandMenu component can read it.
 */
export function createSlashCommandExtension() {
  return Extension.create({
    name: 'slashCommand',

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: SlashCommandPluginKey,
          state: {
            init() {
              return { active: false, query: '', range: null as { from: number; to: number } | null };
            },
            apply(tr, prev, _oldState, newState) {
              // If the transaction is from our own deletion, keep inactive
              if (tr.getMeta(SlashCommandPluginKey)) {
                return { active: false, query: '', range: null };
              }

              // Check if menu should be dismissed (selection not a cursor)
              if (!tr.selection.empty) {
                if (prev.active) return { active: false, query: '', range: null };
                return prev;
              }

              const { $head } = newState.selection;
              const pos = $head.pos;

              // Walk backward from cursor to find the slash
              const textBefore = newState.doc.textBetween(
                Math.max(0, $head.pos - 50),
                $head.pos,
                '\n'
              );

              const slashMatch = textBefore.match(/(?:^|\s)\/([\w-]*)$/);

              if (slashMatch) {
                // Calculate where the slash starts in the document
                const slashPos = pos - slashMatch[1].length - 1;
                const query = slashMatch[1];
                return {
                  active: true,
                  query,
                  range: { from: slashPos, to: pos },
                };
              }

              // Slash was at position with spaces → show empty menu
              const slashAtLineStart = textBefore.match(/^\/([\w-]*)$/);
              if (slashAtLineStart) {
                const query = slashAtLineStart[1];
                const slashPos = pos - query.length - 1;
                return {
                  active: true,
                  query,
                  range: { from: slashPos, to: pos },
                };
              }

              if (prev.active) return { active: false, query: '', range: null };
              return prev;
            },
          },
          props: {
            handleKeyDown(view, event) {
              const state = SlashCommandPluginKey.getState(view.state);
              if (!state?.active) return false;

              if (event.key === 'Escape') {
                // Close menu
                const tr = view.state.tr.setMeta(SlashCommandPluginKey, { close: true });
                view.dispatch(tr);
                return true;
              }

              return false;
            },
          },
        }),
      ];
    },
  });
}

interface SlashCommandMenuProps {
  editor: Editor;
  items?: SlashMenuItem[];
}

export default function SlashCommandMenu({ editor, items = defaultSlashMenuItems }: SlashCommandMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  // Read Plugin state on every editor update
  useEffect(() => {
    const updateHandler = () => {
      const state = SlashCommandPluginKey.getState(editor.state);
      if (state?.active) {
        setIsOpen(true);
        setQuery(state.query);
        setSelectedIndex(0);

        // Get cursor coordinates for positioning
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        setCoords({ top: coords.bottom + 4, left: coords.left });
      } else {
        setIsOpen(false);
        setQuery('');
      }
    };

    editor.on('update', updateHandler);
    editor.on('selectionUpdate', updateHandler);
    return () => {
      editor.off('update', updateHandler);
      editor.off('selectionUpdate', updateHandler);
    };
  }, [editor]);

  // Filter items by query
  const filteredItems = query
    ? items.filter((item) => item.command.includes(query.toLowerCase()) || item.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  // Reset selected index when filtered items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filteredItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + filteredItems.length) % filteredItems.length);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            selectItem(filteredItems[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          closeMenu();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, selectedIndex, filteredItems]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const closeMenu = useCallback(() => {
    // Dispatch a meta transaction to clear the plugin state
    const tr = editor.state.tr.setMeta(SlashCommandPluginKey, { close: true });
    editor.view.dispatch(tr);
    setIsOpen(false);
  }, [editor]);

  const selectItem = useCallback((item: SlashMenuItem) => {
    const state = SlashCommandPluginKey.getState(editor.state);
    if (state?.range) {
      // Delete the /command text
      editor.chain()
        .focus()
        .deleteRange(state.range)
        .run();
    }
    // Execute the action
    item.action(editor);
    closeMenu();
  }, [editor, closeMenu]);

  // Scroll selected item into view
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const selectedEl = menuRef.current.querySelector('.slash-menu-item--selected') as HTMLElement | null;
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, isOpen]);

  if (!isOpen || filteredItems.length === 0) return null;

  return (
    <div
      ref={menuRef}
      class="slash-menu"
      style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
      role="listbox"
      aria-label="Slash commands"
    >
      {filteredItems.map((item, i) => (
        <button
          key={item.command}
          type="button"
          class={`slash-menu-item${i === selectedIndex ? ' slash-menu-item--selected' : ''}`}
          role="option"
          aria-selected={i === selectedIndex}
          onClick={(e) => { e.preventDefault(); selectItem(item); }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span class="slash-menu-item-label">{item.label}</span>
          <span class="slash-menu-item-desc">{item.description}</span>
        </button>
      ))}
    </div>
  );
}