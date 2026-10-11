import { isGuest, type Person } from "@/lib/shopper";

// Whoever is signed in, drawn as their own pose of the mascot. On lime because
// Albert is white and would vanish against the white cards this sits on.
//
// A guest gets the generic figure instead, on the same grey the account menu's
// list uses, so lime stays the colour of being someone. The figure is drawn
// with its own margin in mind, so it sits inset rather than filling the circle
// the way a cropped Albert does.
export default function ProfileIllustration({
  person,
  size,
}: {
  person: Person;
  size: number;
}) {
  if (isGuest(person)) {
    const inner = Math.round(size * 0.62);
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-grays-01"
        style={{ width: size, height: size }}
      >
        <img
          src={person.portrait}
          alt=""
          width={inner}
          height={inner}
          className="max-w-none"
        />
      </span>
    );
  }

  return (
    <span
      className="flex shrink-0 overflow-hidden rounded-full border border-grays-ld-black bg-base-lime"
      style={{ width: size, height: size }}
    >
      <img
        src={person.portrait}
        alt=""
        width={size}
        height={size}
        className="size-full max-w-none object-cover"
      />
    </span>
  );
}
