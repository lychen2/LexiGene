/**
 * Motion helpers shared by the desk.
 *
 * The vocabulary of movement follows the paper-and-ink identity: content
 * settles into place, state changes answer at once, and celebration is a short
 * speck of ink rather than a looping show. Every helper does nothing when the
 * reader asked for reduced motion.
 */

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveal `[data-reveal]` elements as they enter the viewport, once each.
 *
 * Elements carry `data-reveal="№"` to stagger their delay inside a group. The
 * observer disconnects after revealing, so scrolling back does not replay.
 */
export function revealOnScroll(root: ParentNode = document): () => void {
  const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (!targets.length) return () => {};
  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
    for (const target of targets) target.classList.add('is-revealed');
    return () => {};
  }
  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    },
    // Any sliver of the element counts: content that peeks above the fold
    // must never stay invisible waiting for a full scroll.
    { rootMargin: '0px 0px -4% 0px', threshold: 0 },
  );
  for (const target of targets) observer.observe(target);
  return () => observer.disconnect();
}

const INK = ['#a1552f', '#456b54', '#796488', '#c69b6f', '#8a9a6a'];
type Fleck = { x: number; y: number; vx: number; vy: number; r: number; color: string; life: number; spin: number };
let canvas: HTMLCanvasElement | null = null;
let flecks: Fleck[] = [];
let frame = 0;

function layer(): HTMLCanvasElement {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.className = 'ink-burst';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  return canvas;
}

function paint() {
  const surface = canvas!;
  const context = surface.getContext('2d')!;
  const ratio = surface.width / window.innerWidth;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  flecks = flecks.filter(fleck => fleck.life > 0);
  for (const fleck of flecks) {
    fleck.x += fleck.vx;
    fleck.y += fleck.vy;
    fleck.vx *= 0.93;
    fleck.vy = fleck.vy * 0.93 + 0.26;
    fleck.life -= 0.021;
    fleck.spin += 0.1;
    context.save();
    context.globalAlpha = Math.max(0, fleck.life);
    context.translate(fleck.x, fleck.y);
    context.rotate(fleck.spin);
    context.fillStyle = fleck.color;
    // Half dots, half little paper squares: ink splashed on a page.
    if (fleck.r > 3.4) context.fillRect(-fleck.r / 2, -fleck.r / 2, fleck.r, fleck.r * 0.55);
    else {
      context.beginPath();
      context.arc(0, 0, fleck.r / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
  frame = flecks.length ? requestAnimationFrame(paint) : 0;
  if (!frame) context.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

/** A short burst of ink from a point on screen, for a result worth marking. */
export function inkBurst(x: number, y: number, count = 26) {
  if (prefersReducedMotion() || typeof document === 'undefined') return;
  const surface = layer();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (surface.width !== window.innerWidth * ratio || surface.height !== window.innerHeight * ratio) {
    surface.width = window.innerWidth * ratio;
    surface.height = window.innerHeight * ratio;
  }
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    flecks.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2.2,
      r: 2 + Math.random() * 3.2,
      color: INK[i % INK.length],
      life: 1,
      spin: Math.random() * Math.PI,
    });
  }
  if (!frame) frame = requestAnimationFrame(paint);
}

/** Burst from the middle of an element, staying inside the viewport. */
export function burstFromElement(element: Element | null) {
  if (!element) return;
  const box = element.getBoundingClientRect();
  inkBurst(box.left + box.width / 2, box.top + box.height / 2);
}
