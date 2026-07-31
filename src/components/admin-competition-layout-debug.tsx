"use client";

import { useEffect, useMemo, useState } from "react";

type RectSnapshot = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type ElementSnapshot = {
  className: string;
  clientHeight: number;
  clientWidth: number;
  id: string;
  offsetHeight: number;
  offsetWidth: number;
  rect: RectSnapshot;
  scrollHeight: number;
  scrollWidth: number;
  styles: Record<string, string>;
  tagName: string;
  type: string | null;
};

type ParentSnapshot = ElementSnapshot & {
  label: string;
};

type DebugSnapshot = {
  checks: {
    endHeightOver60: boolean | null;
    endInputRightExceedsParent: boolean | null;
    endInputWidthExceedsParentClientWidth: boolean | null;
    firstParentWiderThanViewport: null | ParentSnapshot;
    startHeightOver60: boolean | null;
    startInputRightExceedsParent: boolean | null;
    startInputWidthExceedsParentClientWidth: boolean | null;
  };
  collectedAt: string;
  endDate: ElementSnapshot | null;
  parents: ParentSnapshot[];
  page: {
    bodyClientWidth: number;
    bodyScrollWidth: number;
    devicePixelRatio: number;
    documentClientWidth: number;
    documentScrollWidth: number;
    userAgent: string;
    visualViewportScale: number | null;
    visualViewportWidth: number | null;
    windowInnerWidth: number;
    windowOuterWidth: number;
  };
  startDate: ElementSnapshot | null;
};

const STYLE_PROPS = [
  "display",
  "position",
  "width",
  "minWidth",
  "maxWidth",
  "height",
  "minHeight",
  "maxHeight",
  "boxSizing",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "marginLeft",
  "marginRight",
  "fontSize",
  "lineHeight",
  "appearance",
  "overflow",
  "overflowX",
  "whiteSpace",
  "alignSelf",
  "flex",
  "flexBasis",
  "gridColumn",
  "transform",
] as const;

const PARENT_STYLE_PROPS = [
  "display",
  "width",
  "minWidth",
  "maxWidth",
  "paddingLeft",
  "paddingRight",
  "overflowX",
  "gridTemplateColumns",
] as const;

function rectSnapshot(element: Element): RectSnapshot {
  const rect = element.getBoundingClientRect();

  return {
    bottom: Math.round(rect.bottom * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
    left: Math.round(rect.left * 100) / 100,
    right: Math.round(rect.right * 100) / 100,
    top: Math.round(rect.top * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
  };
}

function classNameSnapshot(element: Element) {
  const className = element.getAttribute("class") ?? "";
  return className.toString();
}

function stylesSnapshot(element: Element, props: readonly string[]) {
  const computed = window.getComputedStyle(element);
  const styles: Record<string, string> = {};

  props.forEach((prop) => {
    styles[prop] = computed.getPropertyValue(prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`));
  });

  styles.webkitAppearance = computed.getPropertyValue("-webkit-appearance");
  styles.zoom = computed.getPropertyValue("zoom");

  return styles;
}

function elementSnapshot(element: HTMLElement, props: readonly string[] = STYLE_PROPS): ElementSnapshot {
  return {
    className: classNameSnapshot(element),
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    id: element.id,
    offsetHeight: element.offsetHeight,
    offsetWidth: element.offsetWidth,
    rect: rectSnapshot(element),
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
    styles: stylesSnapshot(element, props),
    tagName: element.tagName,
    type: element instanceof HTMLInputElement ? element.type : null,
  };
}

function parentChain(startElement: HTMLElement | null) {
  const parents: ParentSnapshot[] = [];
  let current = startElement?.parentElement ?? null;
  let level = 1;

  while (current && parents.length < 8) {
    parents.push({
      ...elementSnapshot(current, PARENT_STYLE_PROPS),
      label: `parent-${level}`,
    });

    if (current.tagName.toLowerCase() === "main") {
      break;
    }

    current = current.parentElement;
    level += 1;
  }

  return parents;
}

function collectSnapshot(): DebugSnapshot {
  const startInput = document.getElementById("competition-start-date") as HTMLInputElement | null;
  const endInput = document.getElementById("competition-end-date") as HTMLInputElement | null;
  const form = startInput?.closest("form") as HTMLElement | null;
  const main = startInput?.closest("main") as HTMLElement | null;
  const startParents = parentChain(startInput);
  const additionalParents: ParentSnapshot[] = [];

  if (form) {
    additionalParents.push({
      ...elementSnapshot(form, PARENT_STYLE_PROPS),
      label: "form",
    });
  }

  if (main) {
    additionalParents.push({
      ...elementSnapshot(main, PARENT_STYLE_PROPS),
      label: "main",
    });
  }

  const parentMap = new Map<string, ParentSnapshot>();
  [...startParents, ...additionalParents].forEach((parent) => {
    const key = `${parent.label}-${parent.tagName}-${parent.rect.top}-${parent.rect.left}`;
    parentMap.set(key, parent);
  });

  const parents = Array.from(parentMap.values());
  const firstParentWiderThanViewport =
    parents.find((parent) => parent.rect.width > window.innerWidth || parent.scrollWidth > window.innerWidth) ?? null;
  const startParent = startInput?.parentElement ?? null;
  const endParent = endInput?.parentElement ?? null;
  const startSnapshot = startInput ? elementSnapshot(startInput) : null;
  const endSnapshot = endInput ? elementSnapshot(endInput) : null;

  return {
    checks: {
      endHeightOver60: endSnapshot ? endSnapshot.rect.height > 60 : null,
      endInputRightExceedsParent:
        endSnapshot && endParent ? endSnapshot.rect.right > rectSnapshot(endParent).right : null,
      endInputWidthExceedsParentClientWidth:
        endSnapshot && endParent ? endSnapshot.rect.width > endParent.clientWidth : null,
      firstParentWiderThanViewport,
      startHeightOver60: startSnapshot ? startSnapshot.rect.height > 60 : null,
      startInputRightExceedsParent:
        startSnapshot && startParent ? startSnapshot.rect.right > rectSnapshot(startParent).right : null,
      startInputWidthExceedsParentClientWidth:
        startSnapshot && startParent ? startSnapshot.rect.width > startParent.clientWidth : null,
    },
    collectedAt: new Date().toISOString(),
    endDate: endSnapshot,
    page: {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      devicePixelRatio: window.devicePixelRatio,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      userAgent: navigator.userAgent,
      visualViewportScale: window.visualViewport?.scale ?? null,
      visualViewportWidth: window.visualViewport?.width ?? null,
      windowInnerWidth: window.innerWidth,
      windowOuterWidth: window.outerWidth,
    },
    parents,
    startDate: startSnapshot,
  };
}

function formatSnapshot(snapshot: DebugSnapshot | null) {
  return snapshot ? JSON.stringify(snapshot, null, 2) : "No measurements collected yet.";
}

export function AdminCompetitionLayoutDebug() {
  const [active, setActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const enabled = window.location.pathname === "/admin/competitions" && currentUrl.searchParams.get("layoutDebug") === "1";

    if (!enabled) {
      return;
    }

    const activationTimer = window.setTimeout(() => {
      setActive(true);
      setSnapshot(collectSnapshot());
    }, 0);

    return () => window.clearTimeout(activationTimer);
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    const startInput = document.getElementById("competition-start-date") as HTMLElement | null;
    const endInput = document.getElementById("competition-end-date") as HTMLElement | null;
    const dateParent = startInput?.parentElement?.parentElement as HTMLElement | null;
    const form = startInput?.closest("form") as HTMLElement | null;
    const outlinedElements = [
      { element: startInput, outline: "2px solid #0ea5e9" },
      { element: endInput, outline: "2px solid #0ea5e9" },
      { element: dateParent, outline: "2px solid #f59e0b" },
      { element: form, outline: "2px solid #ef4444" },
    ];
    const previousOutlines = outlinedElements.map(({ element }) => ({
      element,
      outline: element?.style.outline ?? "",
      outlineOffset: element?.style.outlineOffset ?? "",
    }));

    outlinedElements.forEach(({ element, outline }) => {
      if (!element) {
        return;
      }

      element.style.outline = outline;
      element.style.outlineOffset = "2px";
    });

    return () => {
      previousOutlines.forEach(({ element, outline, outlineOffset }) => {
        if (!element) {
          return;
        }

        element.style.outline = outline;
        element.style.outlineOffset = outlineOffset;
      });
    };
  }, [active]);

  const diagnosticText = useMemo(() => formatSnapshot(snapshot), [snapshot]);

  if (!active) {
    return null;
  }

  async function copyDiagnostics() {
    setCopied(false);

    try {
      await navigator.clipboard.writeText(diagnosticText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function closeDebug() {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("layoutDebug");
    window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    setActive(false);
  }

  return (
    <section
      aria-label="Competition layout diagnostics"
      className="fixed inset-x-3 bottom-3 z-40 max-h-[72vh] min-w-0 overflow-hidden rounded-lg border border-[#d8ad45]/40 bg-[#061426] text-white shadow-2xl shadow-black/30 sm:inset-x-auto sm:right-4 sm:w-[520px]"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-[#f4d58a]">Competition Date Layout Debug</p>
          <p className="mt-1 break-all text-xs font-semibold text-slate-300">
            Active only on /admin/competitions?layoutDebug=1
          </p>
        </div>
        <button
          className="rounded-md border border-white/20 px-3 py-2 text-xs font-black text-white hover:bg-white/10"
          onClick={closeDebug}
          type="button"
        >
          Close debug
        </button>
      </div>

      <div className="max-h-[calc(72vh-74px)] min-w-0 overflow-y-auto px-4 py-3">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <button
            className="rounded-md bg-[#d8ad45] px-3 py-2 text-sm font-black text-[#061426]"
            onClick={() => setSnapshot(collectSnapshot())}
            type="button"
          >
            Refresh measurements
          </button>
          <button
            className="rounded-md border border-[#d8ad45]/45 px-3 py-2 text-sm font-black text-[#f4d58a]"
            onClick={() => void copyDiagnostics()}
            type="button"
          >
            {copied ? "Copied" : "Copy diagnostics"}
          </button>
        </div>

        <textarea
          className="mt-3 h-80 w-full min-w-0 max-w-full resize-y rounded-md border border-white/15 bg-white/10 p-3 font-mono text-xs leading-5 text-white outline-none"
          readOnly
          value={diagnosticText}
        />
      </div>
    </section>
  );
}
