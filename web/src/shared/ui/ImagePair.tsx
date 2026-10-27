import type { ReactNode } from "react";

export interface PairImage {
  src: string;
  alt: string;
  /** Short label shown as text above the image, e.g. the date. */
  label: string;
}

interface ImagePairProps {
  before: PairImage;
  after: PairImage;
  caption?: ReactNode;
  className?: string;
}

/** Two images compared side by side (stacked on phones), each whole with rounded corners. */
export function ImagePair({ before, after, caption, className }: ImagePairProps) {
  return (
    <figure className={className ? `image-pair ${className}` : "image-pair"}>
      <div className="image-pair__grid">
        {[before, after].map((image) => (
          <div key={image.src} className="image-pair__item">
            <p className="image-pair__label">{image.label}</p>
            <img className="content-img" src={image.src} alt={image.alt} loading="lazy" />
          </div>
        ))}
      </div>
      {caption !== undefined && <figcaption className="image-pair__caption">{caption}</figcaption>}
    </figure>
  );
}
