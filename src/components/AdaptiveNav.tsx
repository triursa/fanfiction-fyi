import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

// ── Navigation item definitions ──

export interface NavItem {
  label: string;
  href: string;
  icon: string; // SVG path or symbol reference
  badge?: string;
}

export interface NavGroup {
  primary: NavItem[];
  secondary: NavItem[];
}

// Shared nav items — the same set used across all breakpoints
const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Works', href: '/works', icon: 'search' },
  { label: 'Authors', href: '/pseuds', icon: 'person' },
  { label: 'Bookmarks', href: '/bookmarks', icon: 'bookmark' },
];

const SECONDARY_NAV: NavItem[] = [
  { label: 'Characters', href: '/characters', icon: 'groups' },
  { label: 'Tags', href: '/tags', icon: 'label' },
  { label: 'Series', href: '/series', icon: 'library_books' },
  { label: 'Collections', href: '/collections', icon: 'folder' },
  { label: 'Canon', href: '/canon', icon: 'auto_stories' },
  { label: 'Search', href: '/search', icon: 'manage_search' },
];

const STUDIO_NAV: NavItem[] = [
  { label: 'Studio', href: '/studio', icon: 'studio' },
];

const ADMIN_NAV: NavItem[] = [
  { label: 'Admin', href: '/admin', icon: 'admin_panel_settings' },
];

// ── SVG Icons (M3 style, 24px viewBox) ──

const ICONS: Record<string, string> = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  bookmark: 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z',
  groups: 'M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73C8.93 13.14 10.37 12.75 12 12.75zm-8 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 2.13C4.76 14.34 4 15.13 4 16.07V18H2v-1.61c0-1.18.68-2.26 1.76-2.73.37-.17.78-.31 1.21-.44zm14.87 0c.43.12.84.27 1.21.44C20.32 15.13 21 16.21 21 17.39V19h-2v-1.93c0-.94-.76-1.73-1.87-2.07zM20 12.75c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-8-4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z',
  label: 'M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 2 2 2l11-.01c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z',
  library_books: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z',
  folder: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  auto_stories: 'M19 1l-5 1.5v13L19 14V1zM13 3.5L6.5 5.5v12.76l6.5-2V3.5zM5 6.5l-2 .5v11.5l2-.5V6.5zM21 3l-1 .26v12.06l1-.26V3z',
  manage_search: 'M7 9H3v2h4V9zm0-4H3v2h4V5zm0 8H3v2h4v-2zm12-6H9v2h10V7zm0 4H9v2h10v-2zm0-8H9v2h10V3zm4 14.59l-2.07-2.07c-.63.44-1.39.7-2.21.7C14.74 15.22 13 13.48 13 11.36S14.74 7.5 16.72 7.5c1.98 0 3.72 1.74 3.72 3.86 0 .82-.26 1.58-.7 2.21L22 15.84 20.84 17z',
  admin_panel_settings: 'M17 11c.34 0 .67.04 1 .09V6.27L10.5 3 3 6.27v4.91c0 4.54 3.15 8.79 7.5 9.82.39-.09.76-.21 1.13-.36-.38-.75-.63-1.58-.63-2.48 0-3.31 2.69-6 6-6z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  create: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-.71-.29c-.26 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83z',
  studio: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.61 3.61 0 0112 15.6z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
};

function SvgIcon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={ICONS[name] || ''} />
    </svg>
  );
}

// ── Active route detection ──

function isActive(href: string, currentPath: string): boolean {
  if (href === '/') return currentPath === '/';
  return currentPath.startsWith(href);
}

// ── Mobile Bottom Navigation Bar (< 600px) ──

function MobileBottomNav({ items, currentPath, hidden }: { items: NavItem[]; currentPath: string; hidden?: boolean }) {
  return (
    <nav class={`adaptive-nav mobile-bottom-nav ${hidden ? 'mobile-bottom-nav--hidden' : ''}`} aria-label="Main navigation">
      {items.map((item) => (
        <a
          href={item.href}
          class={`mobile-bottom-nav__item ${isActive(item.href, currentPath) ? 'mobile-bottom-nav__item--active' : ''}`}
          aria-current={isActive(item.href, currentPath) ? 'page' : undefined}
        >
          <span class="mobile-bottom-nav__icon">
            <SvgIcon name={item.icon} size={24} />
          </span>
          <span class="mobile-bottom-nav__label">{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

// ── Navigation Rail (600px – 839px) ──

function NavigationRail({ items, currentPath, onMenuClick }: { items: NavItem[]; currentPath: string; onMenuClick: () => void }) {
  return (
    <nav class="adaptive-nav navigation-rail" aria-label="Main navigation">
      <button class="navigation-rail__fab" onClick={onMenuClick} aria-label="Open menu">
        <SvgIcon name="menu" size={24} />
      </button>
      <div class="navigation-rail__items">
        {items.map((item) => (
          <a
            href={item.href}
            class={`navigation-rail__item ${isActive(item.href, currentPath) ? 'navigation-rail__item--active' : ''}`}
            aria-current={isActive(item.href, currentPath) ? 'page' : undefined}
            title={item.label}
          >
            <span class={`navigation-rail__icon ${isActive(item.href, currentPath) ? 'navigation-rail__icon--active' : ''}`}>
              <SvgIcon name={item.icon} size={24} />
            </span>
            <span class="navigation-rail__label">{item.label}</span>
          </a>
        ))}
      </div>
      <div class="navigation-rail__spacer" />
      <a href="/studio" class="navigation-rail__create" aria-label="Creator Studio" title="Studio">
        <SvgIcon name="studio" size={24} />
      </a>
    </nav>
  );
}

// ── Navigation Drawer (840px+) ──

function NavigationDrawer({ items, secondaryItems, currentPath, userName }: {
  items: NavItem[];
  secondaryItems: NavItem[];
  currentPath: string;
  userName?: string;
}) {
  return (
    <nav class="adaptive-nav navigation-drawer" aria-label="Main navigation">
      <div class="navigation-drawer__head">
        <a href="/" class="navigation-drawer__logo">fanfiction.fyi</a>
      </div>
      <div class="navigation-drawer__items">
        {items.map((item) => (
          <a
            href={item.href}
            class={`navigation-drawer__item ${isActive(item.href, currentPath) ? 'navigation-drawer__item--active' : ''}`}
            aria-current={isActive(item.href, currentPath) ? 'page' : undefined}
          >
            <SvgIcon name={item.icon} size={24} />
            <span>{item.label}</span>
          </a>
        ))}
      </div>
      <div class="navigation-drawer__divider" />
      <div class="navigation-drawer__items">
        {secondaryItems.map((item) => (
          <a
            href={item.href}
            class={`navigation-drawer__item ${isActive(item.href, currentPath) ? 'navigation-drawer__item--active' : ''}`}
            aria-current={isActive(item.href, currentPath) ? 'page' : undefined}
          >
            <SvgIcon name={item.icon} size={24} />
            <span>{item.label}</span>
          </a>
        ))}
      </div>
      <div class="navigation-drawer__spacer" />
      {userName && (
        <div class="navigation-drawer__footer">
          <a href="/studio" class={`navigation-drawer__item ${isActive('/studio', currentPath) ? 'navigation-drawer__item--active' : ''}`}>
            <SvgIcon name="studio" size={24} />
            <span>Studio</span>
          </a>
          <a href="/works/create" class="navigation-drawer__create">
            <SvgIcon name="create" size={20} />
            <span>New Work</span>
          </a>
          <a
            href="/settings"
            class={`navigation-drawer__item ${isActive('/settings', currentPath) ? 'navigation-drawer__item--active' : ''}`}
            aria-current={isActive('/settings', currentPath) ? 'page' : undefined}
          >
            <SvgIcon name="settings" size={24} />
            <span>Settings</span>
          </a>
          <form method="POST" action="/api/auth/logout">
            <button type="submit" class="navigation-drawer__item navigation-drawer__item--button">
              <SvgIcon name="logout" size={24} />
              <span>Sign Out</span>
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}

// ── Modal Drawer (hamburger menu overlay) ──

function ModalDrawer({ isOpen, onClose, primaryItems, secondaryItems, currentPath, userName, isAdmin }: {
  isOpen: boolean;
  onClose: () => void;
  primaryItems: NavItem[];
  secondaryItems: NavItem[];
  currentPath: string;
  userName?: string;
  isAdmin?: boolean;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div class="modal-drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu">
        <div class="modal-drawer__header">
          <a href="/" class="modal-drawer__logo">fanfiction.fyi</a>
          <button class="modal-drawer__close" onClick={onClose} aria-label="Close menu">
            <SvgIcon name="close" size={24} />
          </button>
        </div>
        {userName && (
          <div class="modal-drawer__user">
            <span>{userName}</span>
          </div>
        )}
        <div class="modal-drawer__section">
          <div class="modal-drawer__section-label">Main</div>
          {primaryItems.map((item) => (
            <a
              href={item.href}
              class={`modal-drawer__item ${isActive(item.href, currentPath) ? 'modal-drawer__item--active' : ''}`}
              onClick={onClose}
              aria-current={isActive(item.href, currentPath) ? 'page' : undefined}
            >
              <SvgIcon name={item.icon} size={24} />
              <span>{item.label}</span>
            </a>
          ))}
        </div>
        <div class="modal-drawer__divider" />
        <div class="modal-drawer__section">
          <div class="modal-drawer__section-label">Browse</div>
          {secondaryItems.map((item) => (
            <a
              href={item.href}
              class={`modal-drawer__item ${isActive(item.href, currentPath) ? 'modal-drawer__item--active' : ''}`}
              onClick={onClose}
              aria-current={isActive(item.href, currentPath) ? 'page' : undefined}
            >
              <SvgIcon name={item.icon} size={24} />
              <span>{item.label}</span>
            </a>
          ))}
        </div>
        {userName && (
          <>
            <div class="modal-drawer__divider" />
            <div class="modal-drawer__section">
              <a href="/studio" class="modal-drawer__item" onClick={onClose}>
                <SvgIcon name="studio" size={24} />
                <span>Studio</span>
              </a>
              <a href="/works/create" class="modal-drawer__item modal-drawer__item--create" onClick={onClose}>
                <SvgIcon name="create" size={24} />
                <span>New Work</span>
              </a>
              <a href="/settings" class="modal-drawer__item" onClick={onClose}>
                <SvgIcon name="settings" size={24} />
                <span>Settings</span>
              </a>
              {isAdmin && (
                <a href="/admin" class="modal-drawer__item" onClick={onClose}>
                  <SvgIcon name="admin_panel_settings" size={24} />
                  <span>Admin</span>
                </a>
              )}
              <form method="POST" action="/api/auth/logout">
                <button type="submit" class="modal-drawer__item modal-drawer__item--button">
                  <SvgIcon name="logout" size={24} />
                  <span>Sign Out</span>
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Mobile Top App Bar (visible on mobile/tablet, hidden on desktop) ──

function MobileAppBar({ onMenuClick, userName }: { onMenuClick: () => void; userName?: string }) {
  return (
    <header class="mobile-app-bar">
      <button class="mobile-app-bar__hamburger" onClick={onMenuClick} aria-label="Open navigation menu">
        <SvgIcon name="menu" size={24} />
      </button>
      <a href="/" class="mobile-app-bar__title">fanfiction.fyi</a>
      <div class="mobile-app-bar__actions">
        {userName ? (
          <a href="/studio" class="mobile-app-bar__create" aria-label="Creator Studio">
            <SvgIcon name="studio" size={24} />
          </a>
        ) : (
          <a href="/login" class="mobile-app-bar__signin">Sign In</a>
        )}
      </div>
    </header>
  );
}

// ── Main AdaptiveNav component ──

interface AdaptiveNavProps {
  currentPath: string;
  userName?: string;
  isAdmin?: boolean;
  isReadingMode?: boolean;
}

export default function AdaptiveNav({ currentPath, userName, isAdmin, isReadingMode }: AdaptiveNavProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [bottomNavHidden, setBottomNavHidden] = useState(false);
  const lastScrollY = useRef(0);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  // Scroll-hide for mobile bottom nav (only in reading mode per acceptance criteria)
  useEffect(() => {
    if (!isReadingMode) {
      setBottomNavHidden(false);
      return;
    }

    const handleScroll = () => {
      const currentY = window.scrollY;
      setBottomNavHidden(currentY > lastScrollY.current && currentY > 100);
      lastScrollY.current = currentY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isReadingMode]);

  // Build primary nav items — include Bookmarks only if logged in
  const primaryNav = userName
    ? PRIMARY_NAV
    : PRIMARY_NAV.filter((item) => item.href !== '/bookmarks');

  // Build secondary nav for drawer/modal
  const secondaryNav = [...SECONDARY_NAV];
  if (userName) {
    secondaryNav.unshift(...STUDIO_NAV);
  }
  if (isAdmin) {
    secondaryNav.push(...ADMIN_NAV);
  }

  return (
    <>
      {/* Mobile Top App Bar — visible < 840px */}
      <MobileAppBar onMenuClick={openModal} userName={userName} />

      {/* Mobile Bottom Navigation — visible < 600px */}
      <MobileBottomNav items={primaryNav.slice(0, 5)} currentPath={currentPath} hidden={bottomNavHidden} />

      {/* Navigation Rail — visible 600px – 839px */}
      <NavigationRail items={primaryNav} currentPath={currentPath} onMenuClick={openModal} />

      {/* Navigation Drawer — visible 840px+ */}
      <NavigationDrawer
        items={primaryNav}
        secondaryItems={secondaryNav}
        currentPath={currentPath}
        userName={userName}
      />

      {/* Modal Drawer — overlay, activated by hamburger */}
      <ModalDrawer
        isOpen={modalOpen}
        onClose={closeModal}
        primaryItems={primaryNav}
        secondaryItems={secondaryNav}
        currentPath={currentPath}
        userName={userName}
        isAdmin={isAdmin}
      />
    </>
  );
}