import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons.tsx";

/** CSS pixels between a popover and its button, and between a popover and the window's edges. */
const GAP = 6;
const MARGIN = 8;

/** How far each key moves the focus between a menu's items. */
const STEPS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** The items of a menu that can take the focus: enabled, and not hidden for the window's width. */
function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')].filter(
    (item) => item.checkVisibility(),
  );
}

/** The attributes that make a button open a popover. */
export interface PopoverButtonProps {
  popoverTarget: string;
  "aria-haspopup": "menu" | "dialog";
  "aria-expanded": boolean;
}

/**
 * A menu or a small dialog in the browser's top layer, opened by the button
 * `button` renders. The browser closes it on Escape and on a click outside,
 * and puts the focus back on its button. A menu's items are the elements
 * with a `menuitem` role, which the arrow keys move between.
 */
export function Popover({
  id,
  label,
  kind = "menu",
  side = "bottom",
  align = "start",
  className,
  button,
  children,
}: {
  id: string;
  label: string;
  kind?: "menu" | "dialog";
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
  button: (props: PopoverButtonProps) => ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const popover = ref.current;
    if (!popover) return;
    const style = popover.style;
    // Placed by its button before it shows, then kept inside the window once its size is known.
    const onBeforeToggle = (event: ToggleEvent) => {
      const rect = document.querySelector(`[popovertarget="${id}"]`)?.getBoundingClientRect();
      if (event.newState !== "open" || !rect) return;
      const width = document.documentElement.clientWidth;
      style.inset = "auto";
      style.translate = align === "center" ? "-50% 0" : "none";
      if (side === "bottom") {
        style.top = `${rect.bottom + GAP}px`;
        style.maxHeight = `${innerHeight - rect.bottom - GAP - MARGIN}px`;
      } else {
        style.bottom = `${innerHeight - rect.top + GAP}px`;
        style.maxHeight = `${rect.top - GAP - MARGIN}px`;
      }
      if (align === "end") style.right = `${Math.max(MARGIN, width - rect.right)}px`;
      else if (align === "start") style.left = `${Math.max(MARGIN, rect.left)}px`;
      else style.left = `${rect.left + rect.width / 2}px`;
    };
    const onToggle = (event: ToggleEvent) => {
      const shown = event.newState === "open";
      setOpen(shown);
      if (!shown) return;
      const box = popover.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const left = Math.max(MARGIN, Math.min(box.left, width - MARGIN - box.width));
      if (left !== box.left) {
        style.translate = "none";
        style.right = "auto";
        style.left = `${left}px`;
      }
      const first =
        kind === "menu"
          ? menuItems(popover)[0]
          : popover.querySelector<HTMLElement>("input, button");
      first?.focus();
    };
    // Tab leaves a menu and closes it; the arrow keys, Home, and End move within it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (kind !== "menu") return;
      if (event.key === "Tab") {
        popover.hidePopover();
        return;
      }
      const items = menuItems(popover);
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = STEPS[event.key];
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : step === undefined
              ? null
              : (index + step + items.length) % items.length;
      if (next === null) return;
      event.preventDefault();
      items[next]?.focus();
    };
    popover.addEventListener("beforetoggle", onBeforeToggle);
    popover.addEventListener("toggle", onToggle);
    popover.addEventListener("keydown", onKeyDown);
    return () => {
      popover.removeEventListener("beforetoggle", onBeforeToggle);
      popover.removeEventListener("toggle", onToggle);
      popover.removeEventListener("keydown", onKeyDown);
    };
  }, [id, kind, side, align]);

  const role = { role: kind, "aria-label": label };
  return (
    <>
      {button({ popoverTarget: id, "aria-haspopup": kind, "aria-expanded": open })}
      <div
        ref={ref}
        id={id}
        popover="auto"
        tabIndex={-1}
        className={className ? `demo-popover ${className}` : "demo-popover"}
        {...role}
      >
        {children}
      </div>
    </>
  );
}

/** Closes the popover an item belongs to, which returns the focus to its button. */
export function closePopover(event: SyntheticEvent<HTMLElement>) {
  event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
}

/**
 * The role of a menu item: an action, or with `checked` a choice among the
 * menu's, or with the "menuitemcheckbox" role one that turns on and off.
 */
export function menuItemRole(
  checked?: boolean,
  role: "menuitemradio" | "menuitemcheckbox" = "menuitemradio",
) {
  return checked === undefined ? { role: "menuitem" } : { role, "aria-checked": checked };
}

/** An item of a menu, which closes it. */
export function MenuItem({
  icon,
  role,
  checked,
  disabled,
  onSelect,
  children,
}: {
  icon?: IconName;
  role?: "menuitemcheckbox";
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="demo-menu-item"
      onClick={(event) => {
        closePopover(event);
        onSelect();
      }}
      {...menuItemRole(checked, role)}
    >
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
      {checked ? <Icon name="check" size={18} /> : null}
    </button>
  );
}
