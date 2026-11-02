import type { ZodType } from "zod";
import { price } from "@/lib/format";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const schema: ZodType | undefined = undefined;
  return <html><body data-price={price(1)} data-s={String(schema)}>{children}</body></html>;
}
