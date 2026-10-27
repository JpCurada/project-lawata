import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageCompare } from "../../shared/ui/arc/image-compare/image-compare";
import type { PairImage } from "../../shared/ui/ImagePair";
import type { StoryFigure } from "./stories";

/** Full-size view of one image. Escape, the close button or a click outside the image closes it. */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      // Only one control inside, so Tab stays on it.
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Full-size image" onClick={onClose}>
      <button ref={closeRef} type="button" className="button button--small lightbox__close" onClick={onClose}>
        Close
      </button>
      <img className="lightbox__img" src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
    </div>,
    document.body,
  );
}

/** An image that opens full size when clicked. */
function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className="zoom-image" onClick={() => setOpen(true)}>
        <img className="content-img" src={src} alt={alt} loading="lazy" />
        <span className="zoom-image__hint">View full size</span>
      </button>
      {open && <Lightbox src={src} alt={alt} onClose={close} />}
    </>
  );
}

/** The pair's own pixel size (674 x 579). The frame uses the same proportions, so the cover-sized images are shown whole. */
const PAIR_ASPECT = "674 / 579";

/**
 * Before and after under one divider: drag it, tap the image, or use the arrow keys. The date labels sit above
 * the frame, not on Arc's chips: the full labels don't fit at 400px and chips would cover the after image's
 * annotations. "View full size" opens the after image.
 */
function ComparePair({
  before,
  after,
  caption,
  note,
}: {
  before: PairImage;
  after: PairImage;
  caption: string;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <figure className="compare">
      <ul className="compare__legend">
        <li>
          <span className="compare__side">Left</span> {before.label}
        </li>
        <li>
          <span className="compare__side">Right</span> {after.label}
        </li>
      </ul>
      <ImageCompare
        className="compare__frame"
        before={<img src={before.src} alt={before.alt} />}
        after={<img src={after.src} alt={after.alt} />}
        labels={false}
        label="Before and after: drag to compare"
        aspectRatio={PAIR_ASPECT}
      />
      <button type="button" className="button button--small button--ghost compare__zoom" onClick={() => setOpen(true)}>
        View full size
      </button>
      {open && <Lightbox src={after.src} alt={after.alt} onClose={close} />}
      <figcaption className="story-figure__caption">
        {caption}
        {note !== undefined && <span className="story-figure__note">{note}</span>}
      </figcaption>
    </figure>
  );
}

export function StoryFigureView({ figure }: { figure: StoryFigure }) {
  return (
    <div className="story-figure">
      {figure.kind === "pair" ? (
        <ComparePair before={figure.before} after={figure.after} caption={figure.caption} note={figure.note} />
      ) : (
        <figure className={figure.chart === true ? "story-figure__single story-figure__single--chart" : "story-figure__single"}>
          <ZoomImage src={figure.src} alt={figure.alt} />
          <figcaption className="story-figure__caption">{figure.caption}</figcaption>
        </figure>
      )}
    </div>
  );
}
