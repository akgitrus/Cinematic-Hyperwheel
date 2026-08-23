import { useEffect, useRef, useState } from "react";

interface Props {
  /** Full backdrop image URL for the current reference movie, or null
   * (no movie selected yet, or TMDB has no backdrop for it - see
   * getBackdrop() in api.ts). */
  url: string | null;
}

interface Layer {
  id: number;
  url: string;
  visible: boolean;
}

/**
 * Full-bleed, masked backdrop image behind the whole app, crossfading
 * to the selected movie's TMDB backdrop. Two things make this more than
 * a plain <img src={url}>:
 *
 * - the image is preloaded before it's shown, so switching movies never
 *   flashes a blank/broken image while the new one downloads;
 * - the previous backdrop stays layered underneath and is only removed
 *   once the new one has fully faded in, so consecutive movie picks
 *   crossfade into each other instead of hard-cutting.
 */
export default function HeroBackdrop({ url }: Props) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!url) {
      setLayers([]);
      return;
    }
    if (layers.some((l) => l.url === url)) return;

    let cancelled = false;
    const img = new Image();
    img.src = url;
    img.onload = () => {
      if (cancelled) return;
      const id = ++nextId.current;
      setLayers((prev) => [...prev, { id, url, visible: false }]);
      // Two rAFs: the layer must actually paint at opacity 0 first, or
      // the browser coalesces the initial and final style and the
      // opacity transition never runs.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: true } : l)));
        });
      });
    };
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Once the newest layer has fully faded in, drop every older layer -
  // it's already fully covered by the new one, so this is a free
  // cleanup, never a visible cut.
  const handleTransitionEnd = (id: number) => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === -1 || idx !== prev.length - 1) return prev;
      return prev.slice(idx);
    });
  };

  if (layers.length === 0) return null;

  return (
    <div className="hero-backdrop" aria-hidden="true">
      {layers.map((l) => (
        <img
          key={l.id}
          src={l.url}
          alt=""
          className={"hero-backdrop__img" + (l.visible ? " hero-backdrop__img--visible" : "")}
          onTransitionEnd={() => handleTransitionEnd(l.id)}
        />
      ))}
    </div>
  );
}