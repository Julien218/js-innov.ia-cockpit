import { cn } from "@/lib/utils";

const LETTERS = [
  ["S", "#00D4FF"],
  ["I", "#20B8FF"],
  ["G", "#4E8BFF"],
  ["N", "#755BFF"],
  ["E", "#9E35F3"],
  ["L", "#CA1EE4"],
  ["Y", "#EA12D8"],
  ["A", "#FF00CC"],
];

export default function SignelyaWordmark({ className = "" }) {
  return (
    <span className={cn("signelya-wordmark", className)} aria-label="SIGNELYA">
      {LETTERS.map(([letter, color], index) => (
        <span
          key={letter + index}
          className="signelya-wordmark-letter"
          aria-hidden="true"
          style={{ "--signelya-letter": color, "--signelya-index": index }}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
