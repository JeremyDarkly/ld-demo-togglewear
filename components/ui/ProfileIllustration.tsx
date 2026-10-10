import type { Person } from "@/lib/shopper";

// Whoever is signed in, drawn as their own pose of the mascot. On lime because
// Albert is white and would vanish against the white cards this sits on.
export default function ProfileIllustration({
  person,
  size,
}: {
  person: Person;
  size: number;
}) {
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
