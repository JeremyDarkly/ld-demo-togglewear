// The labelled input Jen repeats across the cart estimator, the shipping form
// and the card fields: an uppercase Xsmall CAPS label over a 44px box with a
// 4px radius and a hairline border.
export default function Field({
  id,
  label,
  defaultValue,
  placeholder,
  inputMode,
  required,
  pattern,
  maxLength,
  autoComplete,
  className = "",
}: {
  id: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  required?: boolean;
  pattern?: string;
  maxLength?: number;
  autoComplete?: string;
  className?: string;
}) {
  // The inputs stay uncontrolled and are read back through FormData on
  // submit, so typing in a long checkout form does not re-render the order
  // summary on every keystroke.
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <label
        htmlFor={id}
        className="font-sohne text-xsmall-caps font-medium uppercase text-grays-04"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        defaultValue={defaultValue}
        placeholder={placeholder}
        inputMode={inputMode}
        required={required}
        pattern={pattern}
        maxLength={maxLength}
        autoComplete={autoComplete}
        className="h-11 w-full rounded-[4px] border border-grays-hairline px-4 font-sohne text-small text-grays-ld-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black"
      />
    </div>
  );
}
