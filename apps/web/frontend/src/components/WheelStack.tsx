import { useEffect, useRef, useState } from "react";
import Wheel from "./Wheel";
import { RecAngle, WheelCircle } from "../api";

interface Props {
  /** Circle to display, or null while nothing is resolved yet (before the
   * first movie is selected, or briefly between an old and new
   * recommendation set settling after a movie/scheme change). */
  circle: WheelCircle | null;
  size: number;
  title?: string;
  overlays?: RecAngle[];
  /** Forwarded to the TOPMOST (newest) layer's Wheel only - see
   * Wheel.tsx's onReadoutHeight doc comment. The outgoing layer's own
   * readout is about to disappear anyway, so only the incoming/current
   * one's height is relevant to a caller doing layout math with it. */
  onReadoutHeight?: (height: number) => void;
}

interface Layer {
  id: number;
  key: string; // "{pc_x}-{pc_y}" - axis-pair identity, not object identity
  circle: WheelCircle;
  size: number;
  title?: string;
  overlays?: RecAngle[];
  visible: boolean;
}

function layerKeyFor(circle: WheelCircle): string {
  return `${circle.axis_x.pc}-${circle.axis_y.pc}`;
}

/**
 * Crossfades between successive wheels instead of swapping them outright.
 * A plain key-based remount (unmount old, mount new at opacity 0, fade in)
 * has a visible gap: the old wheel is gone in the same commit the new one
 * mounts, so for the first frames of the fade-in there's nothing but the
 * page background behind it - a brief, unpleasant flash every time the
 * shown circle changes (e.g. scrolling through the Recommendations list -
 * see RecommendationsPanel.tsx's scrollspy).
 *
 * Same fix as HeroBackdrop.tsx uses for the hero image: keep the outgoing
 * wheel mounted and fully visible underneath, mount the new one on top at
 * opacity 0, fade it in, and only remove the old one once the new one has
 * fully faded in - so there's always something fully opaque on screen.
 * Layers stack via CSS grid (all layers in one cell - see .wheel-stack in
 * index.css), not absolute positioning, so the container doesn't need an
 * explicitly tracked pixel size for the overlap to work.
 *
 * A circle with the SAME axis pair as the current top layer (e.g. only
 * its overlay recommendation points changed, from a scheme switch) is not
 * treated as a new layer - its data is updated in place, so unrelated
 * prop changes never trigger an unnecessary fade.
 */
export default function WheelStack({ circle, size, title, overlays, onReadoutHeight }: Props) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!circle) return;
    const key = layerKeyFor(circle);
    setLayers((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].key === key) {
        // Same circle already showing (or mid fade-in) - update its data
        // without starting a new fade.
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], circle, size, title, overlays };
        return updated;
      }
      const id = ++nextId.current;
      return [...prev, { id, key, circle, size, title, overlays, visible: false }];
    });
    // circle/size/title/overlays are fresh objects/arrays every parent
    // render regardless of whether they logically changed - intentional:
    // the branch above makes re-running this a harmless no-op update
    // rather than an extra fade, so depending on primitives only isn't
    // needed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circle, size, title, overlays]);

  useEffect(() => {
    const pending = layers.find((l) => !l.visible);
    if (!pending) return;
    let cancelled = false;
    // Two rAFs: the layer must actually paint at opacity 0 first, or the
    // browser coalesces the initial and final style and the opacity
    // transition never runs (same reasoning as HeroBackdrop.tsx).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        setLayers((prev) => prev.map((l) => (l.id === pending.id ? { ...l, visible: true } : l)));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [layers]);

  // Once the newest layer has fully faded in, every older layer is
  // completely covered by it - drop them, same cleanup as HeroBackdrop.tsx.
  const handleTransitionEnd = (id: number) => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === -1 || idx !== prev.length - 1) return prev;
      return prev.slice(idx);
    });
  };

  if (layers.length === 0) return null;

  return (
    <div className="wheel-stack">
      {layers.map((l, i) => (
        <div
          key={l.id}
          className={"wheel-stack__layer" + (l.visible ? " wheel-stack__layer--visible" : "")}
          onTransitionEnd={() => handleTransitionEnd(l.id)}
        >
          <Wheel
            circle={l.circle}
            size={l.size}
            title={l.title}
            overlays={l.overlays}
            onReadoutHeight={i === layers.length - 1 ? onReadoutHeight : undefined}
          />
        </div>
      ))}
    </div>
  );
}