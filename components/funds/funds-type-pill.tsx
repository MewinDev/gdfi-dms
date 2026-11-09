import { CoinsIcon, TransferIcon } from "@/components/ui/icons";
import { fundsTypeLabel, pillTone } from "@/lib/funds/types";

/**
 * The funds type of a record: a small soft pill with an icon, the code and the name
 * ("CA · Cash advance", "FT · Fund transfer"). Two soft colours, never the only signal.
 */
export function FundsTypePill({ code, name }: { code: string; name: string }) {
  const tone = pillTone(code);
  const Icon = tone === "ca" ? CoinsIcon : TransferIcon;
  return (
    <span className={`chip c-ftype-${tone}`} data-funds-type={code}>
      <Icon size={14} />
      {fundsTypeLabel({ code, name })}
    </span>
  );
}
