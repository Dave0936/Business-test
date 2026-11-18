/** The "Add motion" revision: a fixed, tested instruction built from a few choices. */

export const MOTION_AREAS = {
  hero: "an entrance for the first screen: the headline and key image arrive in a short, choreographed sequence (staggered lines or words, a mask or clip reveal, or a scale settle), finished within about a second",
  scroll: "scroll motion: sections and images reveal as they enter (staggered, not all the same), one or two scroll-linked effects such as gentle parallax on a large image, a headline that moves or scales with scroll, or a progress line, and smooth scrolling with Lenis",
  hover: "hover and press feedback: links, buttons, cards and images respond (an underline that draws, a springy lift or tilt, an image that zooms slightly inside its frame), and the navigation feels alive",
} as const;

export type MotionArea = keyof typeof MOTION_AREAS;
export type MotionStrength = "subtle" | "bold";

export function motionInstruction(areas: MotionArea[], strength: MotionStrength): string {
  const chosen = (Object.keys(MOTION_AREAS) as MotionArea[]).filter((a) => areas.includes(a));
  if (!chosen.length) throw new Error("Choose at least one kind of motion.");
  const feel = strength === "bold"
    ? "Bold: confident, noticeable motion with real character (bigger distances, springs, overlapping timings), still smooth and never in the way of reading."
    : "Subtle: refined and quiet (short distances, gentle easing, 300 to 700 ms), the kind of motion people feel rather than notice.";
  return [
    "Add motion only. Keep every word, image and the layout exactly as they are; change only styles.css, script.js and the script and stylesheet links needed for motion.",
    `Add: ${chosen.map((a) => MOTION_AREAS[a]).join("; ")}.`,
    feel,
    "Use the bundled toolkit (vendor/motion.js and, for smooth scrolling, vendor/lenis.min.js with vendor/lenis.css) on every page, with CSS where that is simpler. All motion only under prefers-reduced-motion: no-preference; everything visible and usable without JavaScript. Look at the home page on desktop and phone afterwards.",
  ].join("\n");
}
