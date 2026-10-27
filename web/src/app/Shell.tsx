import { LogIn, LogOut, MessageSquare, Moon, Sun, UserRound } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../shared/auth";
import { useTheme } from "../shared/theme/ThemeProvider";
import { CONTACT_EMAIL } from "../shared/contact";
import { FeedbackPanel } from "../shared/ui/Feedback";
import { LogoMark } from "../shared/ui/LogoMark";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/explore", label: "Explore" },
  { to: "/story", label: "Story" },
  { to: "/sampling", label: "Sampling" },
] as const;

/**
 * Account and theme in one place. On desktop a round button (the user's initial, or a person icon when
 * signed out) opens a small panel; in the phone drawer the panel's items show directly (see .account-menu).
 */
function AccountMenu() {
  const { status, user, signIn, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signedIn = status === "loading" ? null : user;
  return (
    <div ref={rootRef} className={open ? "account-menu account-menu--open" : "account-menu"}>
      <button
        ref={triggerRef}
        type="button"
        className="account-menu__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        title={signedIn ? `Signed in as ${signedIn.username}` : "Account and theme"}
        onClick={() => setOpen((value) => !value)}
      >
        {signedIn ? (
          <span aria-hidden="true">{signedIn.username.charAt(0).toUpperCase()}</span>
        ) : (
          <UserRound aria-hidden="true" className="icon" />
        )}
        <span className="visually-hidden">Account menu</span>
      </button>
      <div id={panelId} className="account-menu__panel">
        {signedIn && (
          <p className="account-menu__who" title={signedIn.email ?? signedIn.username}>
            <span className="account-menu__label">Signed in as</span>
            <span className="account-menu__name">{signedIn.username}</span>
          </p>
        )}
        <button type="button" className="account-menu__item" onClick={toggle} title={`Switch to ${nextTheme} theme`}>
          <span aria-hidden="true">{theme === "dark" ? <Sun className="icon" /> : <Moon className="icon" />}</span>
          {`Switch to ${nextTheme} theme`}
        </button>
        {status !== "loading" &&
          (signedIn ? (
            <button type="button" className="account-menu__item" onClick={signOut}>
              <LogOut aria-hidden="true" className="icon" />
              Sign out
            </button>
          ) : (
            <button type="button" className="account-menu__item" onClick={signIn}>
              <LogIn aria-hidden="true" className="icon" />
              Sign in
            </button>
          ))}
      </div>
    </div>
  );
}

/** After the API rejects the token (401) the session is cleared; say so and offer to sign in again. */
function SessionBanner() {
  const { sessionExpired, user, signIn } = useAuth();
  if (!sessionExpired || user !== null) return null;
  return (
    <div className="session-banner" role="status">
      <div className="container session-banner__inner">
        <p className="session-banner__text">Your session has ended. Sign in again to see researcher data.</p>
        <button type="button" className="button button--small" onClick={signIn}>
          Sign in
        </button>
      </div>
    </div>
  );
}

export function Shell() {
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const firstRender = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  // The map is a full-height app with no footer under it. The header is the same on every page.
  const isMap = pathname === "/explore";
  const showFooter = !isMap;
  // Feedback: a floating button everywhere except the map (its controls use that corner), plus a footer link.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);
  const isStoryDetail = /^\/story\/[^/]+/.test(pathname);
  useEffect(() => setFeedbackOpen(false), [pathname]);

  // On navigation (not on first load, not on search-param changes), close the mobile menu and move
  // focus to <main> so keyboard and screen-reader users start at the new page's content. <main> is
  // used rather than the h1 because some pages swap their heading once data loads.
  useEffect(() => {
    setMenuOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Without preventScroll the browser scrolls <main> to the top of the window, under the sticky
    // header, hiding each page's title. Start the new page at the top instead.
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    // The drawer covers the page on phones; stop the page behind it from scrolling.
    document.body.classList.add("menu-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("menu-open");
    };
  }, [menuOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="header">
        <div className="container header__inner">
          <Link to="/" className="brand">
            <LogoMark size={36} className="brand__mark" />
            Lawata
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            className="menu-button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="menu-button__bars" aria-hidden="true" />
            <span className="visually-hidden">{menuOpen ? "Close menu" : "Open menu"}</span>
          </button>
          <div id={menuId} className={menuOpen ? "header__menu header__menu--open" : "header__menu"}>
            <nav className="nav" aria-label="Main">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => (isActive ? "nav__link nav__link--active" : "nav__link")}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="header__actions">
              <AccountMenu />
            </div>
          </div>
          {menuOpen && <div className="header__backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
        </div>
      </header>
      <SessionBanner />
      <main id="main" ref={mainRef} className="main" tabIndex={-1}>
        <Outlet />
      </main>
      {showFooter && (
        <footer className="footer">
          <div className="container">
            <div className="footer__grid">
              <div>
                <p className="footer__brand">
                  <LogoMark size={48} className="footer__mark" />
                  Lawata
                </p>
                <p className="footer__tagline">
                  Satellite triage for water pollution: where unusual water appears, and where a field sample is worth
                  taking.
                </p>
              </div>
              <nav aria-label="Footer">
                <h2 className="footer__heading">Pages</h2>
                <ul className="footer__links">
                  {navItems.map((item) => (
                    <li key={item.to}>
                      <Link to={item.to}>{item.label}</Link>
                    </li>
                  ))}
                  <li>
                    <Link to="/how-its-built">How it's built</Link>
                  </li>
                </ul>
              </nav>
              <div>
                <h2 className="footer__heading">Data</h2>
                <ul className="footer__links">
                  <li>
                    <a href="https://registry.opendata.aws/sentinel-2-l2a-cogs/">Sentinel-2 on AWS Open Data</a>
                  </li>
                </ul>
              </div>
            </div>
            <div className="footer__legal">
              <p className="footer__note">
                Satellites see water colour, not chemicals like PFAS. Flagged plumes are suspicious, verify.
              </p>
              <ul className="footer__legal-links">
                <li>
                  <Link to="/privacy">Privacy notice</Link>
                </li>
                <li>
                  <Link to="/terms">Terms of use</Link>
                </li>
                <li>
                  <button type="button" className="footer__link-button" onClick={() => setFeedbackOpen(true)}>
                    Send feedback
                  </button>
                </li>
                <li>
                  <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                </li>
              </ul>
            </div>
          </div>
        </footer>
      )}
      {!isMap && (
        <button
          type="button"
          className={isStoryDetail ? "feedback-fab feedback-fab--story" : "feedback-fab"}
          aria-haspopup="dialog"
          hidden={feedbackOpen}
          onClick={() => setFeedbackOpen(true)}
        >
          <MessageSquare aria-hidden="true" className="icon" />
          <span className="feedback-fab__label">Send feedback</span>
        </button>
      )}
      <FeedbackPanel open={feedbackOpen} onClose={closeFeedback} />
    </div>
  );
}
