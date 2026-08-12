import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Power Law Book — live",
  description:
    "A twelve-position global macro book on compute and the energy it eats, priced live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
